import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { snapshotAccounts, snapshots } from "@/lib/db/schema";
import { getAccountHistory, getNetWorthHistory, rangeStart } from "@/lib/history";

let db: DB;

function snapshot(date: string, netWorth: number, baseCurrency = "USD", rates: Record<string, number> = {}, native?: [number, string]) {
  const [row] = db
    .insert(snapshots)
    .values({ date, baseCurrency, assets: netWorth, debts: 0, netWorth, fxRates: JSON.stringify(rates) })
    .returning()
    .all();
  const [nativeValue, nativeCurrency] = native ?? [netWorth, baseCurrency];
  db.insert(snapshotAccounts)
    .values({ snapshotId: row.id, accountId: "a1", categoryId: "c", nativeValue, nativeCurrency, baseValue: netWorth, counted: true })
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

  it("converts snapshots taken in another base currency with their stored rates", () => {
    snapshot("2026-01-01", 250, "USD", { EUR: 1.25 }); // 1 EUR = 1.25 USD then
    snapshot("2026-01-02", 300, "USD", { GBP: 1.5 }); // no EUR rate stored: skipped
    snapshot("2026-01-03", 220, "EUR");

    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "EUR" })).toEqual([
      { date: "2026-01-01", assets: 200, debts: 0, netWorth: 200 },
      { date: "2026-01-03", assets: 220, debts: 0, netWorth: 220 },
    ]);
    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "USD" }).map((p) => p.netWorth)).toEqual([250, 300]);
    expect(getAccountHistory(db, "a1", { range: "all", baseCurrency: "EUR" }).map((p) => [p.date, p.baseValue])).toEqual([
      ["2026-01-01", 200],
      ["2026-01-03", 220],
    ]);
  });

  it("uses an account's native value when the snapshot has no rate for the requested currency", () => {
    snapshot("2026-01-01", 300, "USD", {}, [240, "EUR"]);
    expect(getAccountHistory(db, "a1", { range: "all", baseCurrency: "EUR" })).toEqual([
      { date: "2026-01-01", baseValue: 240, nativeValue: 240, nativeCurrency: "EUR" },
    ]);
    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "EUR" })).toEqual([]);
  });
});
