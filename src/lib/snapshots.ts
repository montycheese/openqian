import { eq } from "drizzle-orm";
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

/** YYYY-MM-DD in the machine's timezone, so "today" matches the user's calendar. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Inputs = { categories: Category[]; accounts: Account[]; valuations: Valuation[]; holdings: Holding[] };

/** Upserts the day's snapshot and replaces its per-account rows. */
function writeSnapshot(db: DB, date: string, base: string, convert: Converter, inputs: Inputs): Snapshot {
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
 * Captures today's snapshot after a change to values. Never throws: a failed
 * snapshot must not fail the user's action.
 */
export function recordSnapshot(): void {
  try {
    takeSnapshot(getDb());
  } catch (err) {
    console.error("Couldn't record net worth snapshot:", err);
  }
}
