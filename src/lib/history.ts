import { and, asc, eq, gte } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { snapshotAccounts, snapshots } from "@/lib/db/schema";

export const HISTORY_RANGES = ["1m", "3m", "6m", "1y", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export type NetWorthPoint = { date: string; assets: number; debts: number; netWorth: number };
export type AccountPoint = { date: string; baseValue: number; nativeValue: number | null; nativeCurrency: string | null };

/** First date (YYYY-MM-DD) included in a range, or null for all history. */
export function rangeStart(range: HistoryRange, today = new Date()): string | null {
  if (range === "all") return null;
  const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 }[range];
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Daily net worth in `baseCurrency`, oldest first.
 * Snapshots taken in another base currency are skipped for now.
 */
export function getNetWorthHistory(db: DB, opts: { range: HistoryRange; baseCurrency: string }): NetWorthPoint[] {
  const start = rangeStart(opts.range);
  return db
    .select({ date: snapshots.date, assets: snapshots.assets, debts: snapshots.debts, netWorth: snapshots.netWorth })
    .from(snapshots)
    .where(and(eq(snapshots.baseCurrency, opts.baseCurrency), start ? gte(snapshots.date, start) : undefined))
    .orderBy(asc(snapshots.date))
    .all();
}

/** One account's value per snapshot day, oldest first. */
export function getAccountHistory(
  db: DB,
  accountId: string,
  opts: { range: HistoryRange; baseCurrency: string },
): AccountPoint[] {
  const start = rangeStart(opts.range);
  return db
    .select({
      date: snapshots.date,
      baseValue: snapshotAccounts.baseValue,
      nativeValue: snapshotAccounts.nativeValue,
      nativeCurrency: snapshotAccounts.nativeCurrency,
    })
    .from(snapshotAccounts)
    .innerJoin(snapshots, eq(snapshots.id, snapshotAccounts.snapshotId))
    .where(
      and(
        eq(snapshotAccounts.accountId, accountId),
        eq(snapshots.baseCurrency, opts.baseCurrency),
        start ? gte(snapshots.date, start) : undefined,
      ),
    )
    .orderBy(asc(snapshots.date))
    .all();
}
