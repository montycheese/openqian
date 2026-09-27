import { asc, eq, lt, min } from "drizzle-orm";
import { getDb, type DB } from "@/lib/db";
import {
  accounts,
  categories,
  holdings,
  snapshotAccounts,
  snapshots,
  valuations,
  type Account,
  type Category,
  type Holding,
  type Snapshot,
  type Valuation,
} from "@/lib/db/schema";
import { loadConverter, readBaseCurrency } from "@/lib/fx";
import type { Converter } from "@/lib/money";
import { summarizeNetWorth } from "@/lib/valuation";
import { localDate } from "@/lib/dates";

export { localDate };

type Inputs = { categories: Category[]; accounts: Account[]; valuations: Valuation[]; holdings: Holding[] };

/** Upserts the day's snapshot and replaces its per-account rows. */
function writeSnapshot(db: DB, date: string, base: string, convert: Converter, inputs: Inputs, partial = false): Snapshot {
  const summary = summarizeNetWorth({ baseCurrency: base, ...inputs, convert, includeHidden: true });

  const used = new Set([
    ...inputs.accounts.map((a) => a.currency),
    ...inputs.valuations.map((v) => v.currency),
    ...inputs.holdings.map((h) => h.currency),
  ]);
  used.delete(base);
  const fxRates: Record<string, number> = {};
  for (const c of [...used].sort()) {
    const rate = convert(1, c);
    if (rate !== null) fxRates[c] = rate;
  }

  const rows = summary.categories.flatMap((c) =>
    c.accounts.map((s) => {
      // An empty account is worth zero in its own currency; mixed-currency holdings have no native total.
      const native = s.native ?? (s.isEmpty ? { amount: 0, currency: s.account.currency } : null);
      return {
        accountId: s.account.id,
        categoryId: c.category.id,
        nativeValue: native?.amount ?? null,
        nativeCurrency: native?.currency ?? null,
        baseValue: s.base,
        counted: !s.account.isExcluded && !s.account.isHidden,
      };
    }),
  );

  const values = {
    date,
    baseCurrency: base,
    assets: summary.assets,
    debts: summary.debts,
    netWorth: summary.netWorth,
    fxRates: JSON.stringify(fxRates),
    partial,
  };
  return db.transaction((tx) => {
    const [row] = tx
      .insert(snapshots)
      .values(values)
      .onConflictDoUpdate({ target: snapshots.date, set: { ...values, updatedAt: new Date() } })
      .returning()
      .all();
    tx.delete(snapshotAccounts).where(eq(snapshotAccounts.snapshotId, row.id)).run();
    if (rows.length > 0) tx.insert(snapshotAccounts).values(rows.map((r) => ({ ...r, snapshotId: row.id }))).run();
    return row;
  });
}

/**
 * Records current values as the snapshot for `date` (default: today, local time),
 * replacing any earlier capture that day. Returns null when there are no accounts.
 *
 * Only the given day is written: a valuation backdated to an earlier day does not
 * rewrite that day's snapshot, since snapshots record what was known at the time.
 */
export function takeSnapshot(db: DB, opts: { date?: string } = {}): Snapshot | null {
  const allAccounts = db.select().from(accounts).all();
  if (allAccounts.length === 0) return null;
  const base = readBaseCurrency(db);
  return writeSnapshot(db, opts.date ?? localDate(), base, loadConverter(db, base), {
    categories: db.select().from(categories).all(),
    accounts: allAccounts,
    valuations: db.select().from(valuations).all(),
    holdings: db.select().from(holdings).all(),
  });
}

/**
 * Reconstructs snapshots for days before the first one, from valuation history,
 * so charts aren't blank for data entered after the fact. Each valuation date
 * gets a snapshot of the value accounts known by then. Holdings keep no history,
 * so a day missing any account that has data today is marked `partial`, which
 * keeps it out of net worth history while per-account history can still use it.
 * Rates are today's (stored with each snapshot) since past rates aren't kept.
 * Returns the number of days written.
 */
export function backfillSnapshots(db: DB, opts: { today?: string } = {}): number {
  const today = opts.today ?? localDate();
  const earliest = db.select({ date: min(snapshots.date) }).from(snapshots).get()?.date ?? null;
  const cutoff = earliest && earliest < today ? earliest : today;
  const dates = db
    .selectDistinct({ date: valuations.date })
    .from(valuations)
    .where(lt(valuations.date, cutoff))
    .orderBy(asc(valuations.date))
    .all()
    .map((r) => r.date);
  if (dates.length === 0) return 0;

  const base = readBaseCurrency(db);
  const convert = loadConverter(db, base);
  const allCategories = db.select().from(categories).all();
  const allAccounts = db.select().from(accounts).all();
  const allValuations = db.select().from(valuations).all();
  const hasData = new Set([
    ...allValuations.map((v) => v.accountId),
    ...db.selectDistinct({ id: holdings.accountId }).from(holdings).all().map((r) => r.id),
  ]);

  for (const date of dates) {
    const known = allValuations.filter((v) => v.date <= date);
    const valued = new Set(known.map((v) => v.accountId));
    const included = allAccounts.filter((a) => a.kind === "value" && valued.has(a.id));
    const partial = allAccounts.some(
      (a) => !a.isHidden && !a.isExcluded && hasData.has(a.id) && !valued.has(a.id),
    );
    writeSnapshot(
      db,
      date,
      base,
      convert,
      { categories: allCategories, accounts: included, valuations: known, holdings: [] },
      partial,
    );
  }
  return dates.length;
}

/**
 * Captures today's snapshot after a change to values, and backfills earlier
 * days if needed. Never throws: a failed snapshot must not fail the user's action.
 */
export function recordSnapshot(): void {
  try {
    const db = getDb();
    takeSnapshot(db);
    backfillSnapshots(db);
  } catch (err) {
    console.error("Couldn't record net worth snapshot:", err);
  }
}
