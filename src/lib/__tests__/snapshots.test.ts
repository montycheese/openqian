import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { accounts, categories, fxRates, holdings, settings, snapshotAccounts, snapshots, valuations } from "@/lib/db/schema";
import { localDate, takeSnapshot } from "@/lib/snapshots";

let db: DB;

const category = (name: string) => db.select().from(categories).all().find((c) => c.name === name)!;

function account(values: Partial<typeof accounts.$inferInsert> & { name: string; category: string }) {
  const { category: cat, ...rest } = values;
  const [row] = db
    .insert(accounts)
    .values({ kind: "value", currency: "USD", ...rest, categoryId: category(cat).id })
    .returning()
    .all();
  return row;
}

const value = (accountId: string, amount: number, currency = "USD", date = "2026-09-01") =>
  db.insert(valuations).values({ accountId, date, value: amount, currency }).run();

const rowsOf = (snapshotId: string) =>
  db.select().from(snapshotAccounts).where(eq(snapshotAccounts.snapshotId, snapshotId)).all();

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("localDate", () => {
  it("uses the local calendar day", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

describe("takeSnapshot", () => {
  it("skips writing when there are no accounts", () => {
    expect(takeSnapshot(db)).toBeNull();
    expect(db.select().from(snapshots).all()).toEqual([]);
  });

  it("records totals and per-account values for today by default", () => {
    const cash = account({ name: "Checking", category: "Cash" });
    const card = account({ name: "Card", category: "Credit Cards" });
    value(cash.id, 1000);
    value(card.id, 200);

    const snap = takeSnapshot(db)!;
    expect(snap).toMatchObject({ date: localDate(), baseCurrency: "USD", assets: 1000, debts: 200, netWorth: 800, fxRates: "{}" });
    expect(rowsOf(snap.id)).toEqual(
      expect.arrayContaining([
        { snapshotId: snap.id, accountId: cash.id, categoryId: category("Cash").id, nativeValue: 1000, nativeCurrency: "USD", baseValue: 1000, counted: true },
        { snapshotId: snap.id, accountId: card.id, categoryId: category("Credit Cards").id, nativeValue: 200, nativeCurrency: "USD", baseValue: 200, counted: true },
      ]),
    );
  });

  it("replaces the same day's snapshot and its account rows", () => {
    const a = account({ name: "A", category: "Cash" });
    const b = account({ name: "B", category: "Cash" });
    value(a.id, 100);
    value(b.id, 50);
    const first = takeSnapshot(db, { date: "2026-09-10" })!;

    value(a.id, 300, "USD", "2026-09-02");
    db.delete(accounts).where(eq(accounts.id, b.id)).run();
    const second = takeSnapshot(db, { date: "2026-09-10" })!;

    expect(second.id).toBe(first.id);
    expect(db.select().from(snapshots).all()).toHaveLength(1);
    expect(second.netWorth).toBe(300);
    expect(rowsOf(second.id).map((r) => [r.accountId, r.baseValue])).toEqual([[a.id, 300]]);
  });

  it("keeps separate days and older rows for deleted accounts", () => {
    const a = account({ name: "A", category: "Cash" });
    value(a.id, 100);
    const old = takeSnapshot(db, { date: "2026-09-01" })!;
    account({ name: "B", category: "Cash" });
    db.delete(accounts).where(eq(accounts.id, a.id)).run();
    takeSnapshot(db, { date: "2026-09-02" });
    expect(db.select().from(snapshots).all()).toHaveLength(2);
    expect(rowsOf(old.id)).toHaveLength(1);
  });

  it("records hidden and excluded accounts as not counted", () => {
    const shown = account({ name: "Shown", category: "Cash" });
    const hidden = account({ name: "Hidden", category: "Cash", isHidden: true });
    const excluded = account({ name: "Excluded", category: "Cash", isExcluded: true });
    value(shown.id, 1);
    value(hidden.id, 10);
    value(excluded.id, 100);

    const snap = takeSnapshot(db)!;
    expect(snap.netWorth).toBe(1);
    const counted = Object.fromEntries(rowsOf(snap.id).map((r) => [r.accountId, [r.counted, r.baseValue]]));
    expect(counted).toEqual({ [shown.id]: [true, 1], [hidden.id]: [false, 10], [excluded.id]: [false, 100] });
  });

  it("stores the FX rates used and native values", () => {
    db.insert(settings).values({ key: "base_currency", value: "USD" }).run();
    db.insert(fxRates).values({ date: "2026-09-01", base: "USD", quote: "EUR", rate: 0.8, source: "frankfurter" }).run();
    const eur = account({ name: "Euro", category: "Cash", currency: "EUR" });
    value(eur.id, 100, "EUR");
    const gbp = account({ name: "Pound", category: "Cash", currency: "GBP" });
    value(gbp.id, 10, "GBP");

    const snap = takeSnapshot(db)!;
    // GBP has no rate, so it's left out rather than guessed.
    expect(JSON.parse(snap.fxRates)).toEqual({ EUR: 1.25 });
    expect(snap.netWorth).toBeCloseTo(125);
    expect(rowsOf(snap.id).find((r) => r.accountId === eur.id)).toMatchObject({ nativeValue: 100, nativeCurrency: "EUR", baseValue: 125 });
  });

  it("leaves native value null when holdings span currencies", () => {
    db.insert(fxRates).values({ date: "2026-09-01", base: "EUR", quote: "USD", rate: 2, source: "manual" }).run();
    const broker = account({ name: "Broker", category: "Investments", kind: "holdings" });
    const empty = account({ name: "Empty", category: "Investments", kind: "holdings", currency: "EUR" });
    db.insert(holdings)
      .values([
        { accountId: broker.id, name: "VOO", marketValue: 500, currency: "USD" },
        { accountId: broker.id, name: "SAP", marketValue: 100, currency: "EUR" },
      ])
      .run();

    const snap = takeSnapshot(db)!;
    const rows = Object.fromEntries(rowsOf(snap.id).map((r) => [r.accountId, r]));
    expect(rows[broker.id]).toMatchObject({ nativeValue: null, nativeCurrency: null, baseValue: 700 });
    expect(rows[empty.id]).toMatchObject({ nativeValue: 0, nativeCurrency: "EUR", baseValue: 0 });
    expect(JSON.parse(snap.fxRates)).toEqual({ EUR: 2 });
  });
});
