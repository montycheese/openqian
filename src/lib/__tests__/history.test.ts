import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { snapshotAccounts, snapshots } from "@/lib/db/schema";
import { getAccountHistory, getNetWorthHistory, rangeStart } from "@/lib/history";

let db: DB;

function snapshot(date: string, netWorth: number, baseCurrency = "USD") {
  const [row] = db
    .insert(snapshots)
    .values({ date, baseCurrency, assets: netWorth, debts: 0, netWorth })
    .returning()
    .all();
  db.insert(snapshotAccounts)
    .values({ snapshotId: row.id, accountId: "a1", categoryId: "c", nativeValue: netWorth, nativeCurrency: baseCurrency, baseValue: netWorth, counted: true })
    .run();
}

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("rangeStart", () => {
  it("goes back whole months", () => {
    const today = new Date("2026-09-27T12:00:00Z");
    expect(rangeStart("1m", today)).toBe("2026-08-27");
    expect(rangeStart("1y", today)).toBe("2025-09-27");
    expect(rangeStart("all", today)).toBeNull();
  });
});

describe("history queries", () => {
  it("returns points oldest first, filtered by range and base currency", () => {
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
    snapshot(daysAgo(400), 1);
    snapshot(daysAgo(10), 2);
    snapshot(daysAgo(5), 3, "EUR");
    snapshot(daysAgo(1), 4);

    expect(getNetWorthHistory(db, { range: "1m", baseCurrency: "USD" }).map((p) => p.netWorth)).toEqual([2, 4]);
    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "USD" }).map((p) => p.netWorth)).toEqual([1, 2, 4]);
    expect(getAccountHistory(db, "a1", { range: "all", baseCurrency: "USD" }).map((p) => p.baseValue)).toEqual([1, 2, 4]);
  });
});
