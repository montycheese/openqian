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
 * Multiplier from a snapshot's base currency into `target`, using the rates
 * stored with that snapshot (never today's rates), or null when it can't be done.
 */
function factorTo(target: string, snapshot: { baseCurrency: string; fxRates: string }): number | null {
  if (snapshot.baseCurrency === target) return 1;
  let rates: Record<string, unknown>;
  try {
    rates = JSON.parse(snapshot.fxRates) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Stored as snapshot-base units per 1 unit of each currency.
  const perTarget = rates[target];
  return typeof perTarget === "number" && Number.isFinite(perTarget) && perTarget > 0 ? 1 / perTarget : null;
}

/**
 * Daily net worth in `baseCurrency`, oldest first. Snapshots taken in another
 * base currency are converted with their stored rates, or skipped when they
 * have no rate for `baseCurrency`.
 */
export function getNetWorthHistory(db: DB, opts: { range: HistoryRange; baseCurrency: string }): NetWorthPoint[] {
  const start = rangeStart(opts.range);
  const rows = db
    .select()
    .from(snapshots)
    .where(start ? gte(snapshots.date, start) : undefined)
    .orderBy(asc(snapshots.date))
    .all();
  return rows.flatMap((s) => {
    const f = factorTo(opts.baseCurrency, s);
    return f === null ? [] : [{ date: s.date, assets: s.assets * f, debts: s.debts * f, netWorth: s.netWorth * f }];
  });
}

/** One account's value per snapshot day, oldest first; base values converted as in getNetWorthHistory. */
export function getAccountHistory(
  db: DB,
  accountId: string,
  opts: { range: HistoryRange; baseCurrency: string },
): AccountPoint[] {
  const start = rangeStart(opts.range);
  const rows = db
    .select({
      date: snapshots.date,
      baseCurrency: snapshots.baseCurrency,
      fxRates: snapshots.fxRates,
      baseValue: snapshotAccounts.baseValue,
      nativeValue: snapshotAccounts.nativeValue,
      nativeCurrency: snapshotAccounts.nativeCurrency,
    })
    .from(snapshotAccounts)
    .innerJoin(snapshots, eq(snapshots.id, snapshotAccounts.snapshotId))
    .where(and(eq(snapshotAccounts.accountId, accountId), start ? gte(snapshots.date, start) : undefined))
    .orderBy(asc(snapshots.date))
    .all();
  return rows.flatMap(({ baseCurrency, fxRates, ...p }) => {
    const f = factorTo(opts.baseCurrency, { baseCurrency, fxRates });
    if (f !== null) return [{ ...p, baseValue: p.baseValue * f }];
    // Without a rate, an account held in the requested currency still has an exact value.
    return p.nativeCurrency === opts.baseCurrency && p.nativeValue !== null ? [{ ...p, baseValue: p.nativeValue }] : [];
  });
}
