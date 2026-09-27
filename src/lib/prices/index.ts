import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { USD_STABLECOINS } from "@/lib/connections/exchange";
import type { DB } from "@/lib/db";
import { accounts, holdings, prices, type HoldingType } from "@/lib/db/schema";
import { coinGeckoProvider } from "./coingecko";
import { isoDate, type PriceKind, type PriceProvider, type Quote } from "./types";
import { yahooProvider } from "./yahoo";

export type { PriceKind, PriceProvider, Quote } from "./types";

export type RefreshResult = { updated: number; unpriced: string[]; errors: string[] };

export const defaultProviders: Record<PriceKind, PriceProvider> = {
  security: yahooProvider,
  crypto: coinGeckoProvider,
};

const PRICED_TYPES: HoldingType[] = ["stock", "etf", "fund", "crypto"];

const kindOf = (type: HoldingType): PriceKind => (type === "crypto" ? "crypto" : "security");
const normalize = (symbol: string) => symbol.trim().toUpperCase();

function describeError(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "timed out";
  if (err instanceof TypeError && err.message === "fetch failed") return "couldn't connect; check your internet connection";
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

/**
 * Fetches current prices for holdings with a symbol and quantity and revalues
 * them. Holdings in connected accounts are priced by their connection and are
 * left alone. Never throws for provider failures; they're reported in `errors`.
 * `unpriced` lists symbols a working provider had no quote for.
 */
export async function refreshPrices(
  db: DB,
  providers: Record<PriceKind, PriceProvider> = defaultProviders,
): Promise<RefreshResult> {
  const rows = db
    .select({ id: holdings.id, symbol: holdings.symbol, type: holdings.type, quantity: holdings.quantity })
    .from(holdings)
    .innerJoin(accounts, eq(holdings.accountId, accounts.id))
    .where(
      and(
        isNotNull(holdings.symbol),
        isNotNull(holdings.quantity),
        inArray(holdings.type, PRICED_TYPES),
        ne(accounts.source, "connection"),
      ),
    )
    .all()
    .filter((r) => r.symbol && r.symbol.trim())
    .map((r) => ({ ...r, symbol: normalize(r.symbol!), quantity: r.quantity!, kind: kindOf(r.type) }));

  const now = new Date();
  // Quotes by kind, then symbol, with the source they came from.
  const found: Record<PriceKind, Map<string, Quote & { source: string }>> = { security: new Map(), crypto: new Map() };
  const failed = new Set<PriceKind>();
  const errors: string[] = [];

  await Promise.all(
    (["security", "crypto"] as const).map(async (kind) => {
      let symbols = [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.symbol))];
      if (kind === "crypto") {
        // Pegged to the dollar; not worth a request.
        for (const s of symbols.filter((s) => USD_STABLECOINS.has(s))) {
          found.crypto.set(s, { price: 1, currency: "USD", date: isoDate(now), source: "peg" });
        }
        symbols = symbols.filter((s) => !USD_STABLECOINS.has(s));
      }
      if (symbols.length === 0) return;
      const provider = providers[kind];
      try {
        const quotes = await provider.fetchQuotes(symbols);
        for (const s of symbols) {
          const q = quotes.get(s);
          if (q && Number.isFinite(q.price) && q.price > 0) found[kind].set(s, { ...q, source: provider.id });
        }
      } catch (err) {
        failed.add(kind);
        errors.push(`${provider.label}: ${describeError(err)}`);
      }
    }),
  );

  let updated = 0;
  const unpriced = new Set<string>();
  db.transaction((tx) => {
    for (const kind of ["security", "crypto"] as const) {
      for (const [symbol, q] of found[kind]) {
        tx.insert(prices)
          .values({ symbol, kind, date: q.date, price: q.price, currency: q.currency, source: q.source, fetchedAt: now })
          .onConflictDoUpdate({
            target: [prices.symbol, prices.kind, prices.date, prices.source],
            set: { price: q.price, currency: q.currency, fetchedAt: now },
          })
          .run();
      }
    }
    for (const r of rows) {
      const q = found[r.kind].get(r.symbol);
      if (!q) {
        if (!failed.has(r.kind)) unpriced.add(r.symbol);
        continue;
      }
      tx.update(holdings)
        .set({
          price: q.price,
          marketValue: r.quantity * q.price,
          currency: q.currency,
          priceSource: "feed",
          priceAsOf: now,
        })
        .where(eq(holdings.id, r.id))
        .run();
      updated++;
    }
  });

  return { updated, unpriced: [...unpriced], errors };
}
