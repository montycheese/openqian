import { and, eq, or } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { accounts, fxRates, holdings, settings, valuations, type FxRate } from "@/lib/db/schema";
import { DEFAULT_BASE_CURRENCY, type Converter } from "@/lib/money";

/** Frankfurter v2: free, keyless central-bank reference rates (v1 is deprecated). */
const FRANKFURTER = "https://api.frankfurter.dev/v2";

type Source = FxRate["source"];

export type RateInfo = {
  currency: string;
  /** Units of the base currency per 1 `currency`, or null when missing. */
  rate: number | null;
  source: Source | null;
  date: string | null;
  /** Currency the rate was crossed through, when not stored against the base. */
  via: string | null;
  missing: boolean;
  /** The stored manual pair in effect, so it can be cleared. */
  manualPair: { base: string; quote: string } | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export function readBaseCurrency(db: DB): string {
  return db.select().from(settings).where(eq(settings.key, "base_currency")).get()?.value ?? DEFAULT_BASE_CURRENCY;
}

/** Non-base currencies used by any account, valuation, or holding, sorted. */
export function currenciesInUse(db: DB, base: string): string[] {
  const all = [
    ...db.selectDistinct({ c: accounts.currency }).from(accounts).all(),
    ...db.selectDistinct({ c: valuations.currency }).from(valuations).all(),
    ...db.selectDistinct({ c: holdings.currency }).from(holdings).all(),
  ].map((r) => r.c);
  return [...new Set(all)].filter((c) => c !== base).sort();
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message;
    throw new Error(`Frankfurter returned ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body;
}

/** Fetches latest rates for every currency in use against the base currency. */
export async function refreshFxRates(
  db: DB,
  fetchImpl: typeof fetch = fetch,
): Promise<{ currencies: string[]; unsupported: string[]; error?: string }> {
  const base = readBaseCurrency(db);
  const wanted = currenciesInUse(db, base);
  if (wanted.length === 0) return { currencies: [], unsupported: [] };

  try {
    // One unknown code makes /rates fail outright, so filter against /currencies first.
    const list = (await getJson(fetchImpl, `${FRANKFURTER}/currencies`)) as { iso_code: string }[];
    const known = new Set(list.map((c) => c.iso_code));
    if (!known.has(base)) return { currencies: [], unsupported: wanted, error: `Frankfurter has no rates for ${base}` };

    const supported = wanted.filter((c) => known.has(c));
    let rows: { date: string; base: string; quote: string; rate: number }[] = [];
    if (supported.length > 0) {
      rows = (await getJson(
        fetchImpl,
        `${FRANKFURTER}/rates?base=${base}&quotes=${supported.join(",")}`,
      )) as typeof rows;
    }
    rows = rows.filter((r) => r.base === base && supported.includes(r.quote) && Number.isFinite(r.rate) && r.rate > 0);

    const fetchedAt = new Date();
    db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(fxRates)
          .values({ date: r.date, base, quote: r.quote, rate: r.rate, source: "frankfurter", fetchedAt })
          .onConflictDoUpdate({
            target: [fxRates.date, fxRates.base, fxRates.quote, fxRates.source],
            set: { rate: r.rate, fetchedAt },
          })
          .run();
      }
    });
    const got = new Set(rows.map((r) => r.quote));
    return { currencies: wanted.filter((c) => got.has(c)), unsupported: wanted.filter((c) => !got.has(c)) };
  } catch (err) {
    return { currencies: [], unsupported: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- Conversion ----------

const pairKey = (a: string, b: string) => (a < b ? `${a}/${b}` : `${b}/${a}`);

/** Units of the other currency per 1 `from`, reading a stored row in either direction. */
const along = (r: FxRate, from: string) => (r.base === from ? r.rate : 1 / r.rate);
const other = (r: FxRate, c: string) => (r.base === c ? r.quote : r.base);

function preferOver(r: FxRate, cur: FxRate): boolean {
  if (r.source !== cur.source) return r.source === "manual";
  return r.date > cur.date || (r.date === cur.date && r.fetchedAt > cur.fetchedAt);
}

/** The rate in effect per currency pair: manual beats fetched, then newest wins. */
function effectiveRates(db: DB): Map<string, FxRate> {
  const out = new Map<string, FxRate>();
  for (const r of db.select().from(fxRates).all()) {
    const key = pairKey(r.base, r.quote);
    const cur = out.get(key);
    if (!cur || preferOver(r, cur)) out.set(key, r);
  }
  return out;
}

type Resolved = { rate: number; leg: FxRate; via: string | null; date: string };

/**
 * Base units per 1 `currency`: directly, or crossed through another currency when
 * rates were stored against a previous base. A manual rate on the currency's own
 * leg wins; otherwise a direct rate beats a cross rate.
 */
function resolve(rates: Map<string, FxRate>, base: string, currency: string): Resolved | null {
  const candidates: Resolved[] = [];
  const direct = rates.get(pairKey(base, currency));
  if (direct) candidates.push({ rate: along(direct, currency), leg: direct, via: null, date: direct.date });
  for (const leg of rates.values()) {
    if (leg.base !== currency && leg.quote !== currency) continue;
    const pivot = other(leg, currency);
    const toBase = pivot === base ? undefined : rates.get(pairKey(pivot, base));
    if (!toBase) continue;
    candidates.push({
      rate: along(leg, currency) * along(toBase, pivot),
      leg,
      via: pivot,
      date: leg.date < toBase.date ? leg.date : toBase.date,
    });
  }
  const rank = (c: Resolved) => (c.leg.source === "manual" ? 0 : 2) + (c.via ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}

/** Converts amounts into `base` using stored rates; null when no rate is known. */
export function loadConverter(db: DB, base: string): Converter {
  const rates = effectiveRates(db);
  const cache = new Map<string, number | null>();
  return (amount, currency) => {
    if (currency === base) return amount;
    if (!cache.has(currency)) cache.set(currency, resolve(rates, base, currency)?.rate ?? null);
    const rate = cache.get(currency)!;
    return rate === null ? null : amount * rate;
  };
}

/** Rate status for each non-base currency in use, for the settings page. */
export function listRates(db: DB, base: string): RateInfo[] {
  const rates = effectiveRates(db);
  return currenciesInUse(db, base).map((currency) => {
    const r = resolve(rates, base, currency);
    return {
      currency,
      rate: r?.rate ?? null,
      source: r?.leg.source ?? null,
      date: r?.date ?? null,
      via: r?.via ?? null,
      missing: !r,
      manualPair: r?.leg.source === "manual" ? { base: r.leg.base, quote: r.leg.quote } : null,
    };
  });
}

// ---------- Manual overrides ----------

const manualRowsFor = (base: string, quote: string) =>
  and(
    eq(fxRates.source, "manual"),
    or(and(eq(fxRates.base, base), eq(fxRates.quote, quote)), and(eq(fxRates.base, quote), eq(fxRates.quote, base))),
  );

/** Stores 1 `base` = `rate` `quote` as today's manual rate, replacing earlier overrides for the pair. */
export function setManualRate(db: DB, base: string, quote: string, rate: number) {
  db.transaction((tx) => {
    tx.delete(fxRates).where(manualRowsFor(base, quote)).run();
    tx.insert(fxRates).values({ date: today(), base, quote, rate, source: "manual" }).run();
  });
}

/** Removes manual overrides for the pair (either direction). */
export function clearManualRate(db: DB, base: string, quote: string) {
  db.delete(fxRates).where(manualRowsFor(base, quote)).run();
}
