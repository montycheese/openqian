import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { accounts, categories, fxRates, holdings, settings, snapshotAccounts, snapshots, valuations } from "@/lib/db/schema";
import { getAccountHistory, getNetWorthHistory } from "@/lib/history";
import { backfillSnapshots, localDate, recordSnapshot, takeSnapshot } from "@/lib/snapshots";

process.env.OPENCHIENG_PASSPHRASE = "test-passphrase"; // keep tests out of the real keychain

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("@/lib/snapshots", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/snapshots")>();
  return { ...mod, recordSnapshot: vi.fn(mod.recordSnapshot) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/prices", () => ({
  // Stands in for a feed: every holding is repriced to 999.
  refreshPrices: vi.fn(async (d: DB) => {
    d.update(holdings).set({ marketValue: 999 }).run();
    return { updated: 1, unpriced: [], errors: [] };
  }),
}));
vi.mock("@/lib/connections/exchange", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections/exchange")>();
  return {
    ...mod,
    createExchange: async () => ({}),
    excessPermissions: async () => [],
    fetchPositions: async () => ({ ...mod.toPositions({ BTC: 1 }, { BTC: 100_000 }), warnings: [] }),
  };
});

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

describe("backfillSnapshots", () => {
  const all = () => db.select().from(snapshots).orderBy(snapshots.date).all();

  it("rebuilds complete days from valuation history when there are only value accounts", () => {
    const cash = account({ name: "Cash", category: "Cash" });
    const loan = account({ name: "Loan", category: "Loans" });
    value(cash.id, 100, "USD", "2026-01-01");
    value(loan.id, 40, "USD", "2026-01-01");
    value(cash.id, 150, "USD", "2026-02-01");
    value(cash.id, 999, "USD", "2026-09-27"); // today: left to takeSnapshot

    expect(backfillSnapshots(db, { today: "2026-09-27" })).toBe(2);
    expect(all().map((s) => [s.date, s.netWorth, s.partial])).toEqual([
      ["2026-01-01", 60, false],
      ["2026-02-01", 110, false],
    ]);
    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "USD" }).map((p) => p.netWorth)).toEqual([60, 110]);
  });

  it("marks days missing holdings or not-yet-valued accounts as partial", () => {
    const house = account({ name: "House", category: "Real Estate" });
    const cash = account({ name: "Cash", category: "Cash" });
    const broker = account({ name: "Broker", category: "Investments", kind: "holdings" });
    account({ name: "Hidden", category: "Cash", isHidden: true, kind: "holdings" });
    db.insert(holdings).values({ accountId: broker.id, name: "VOO", marketValue: 500, currency: "USD" }).run();
    value(house.id, 300_000, "USD", "2020-01-01");
    value(cash.id, 50, "USD", "2026-09-01");

    takeSnapshot(db, { date: "2026-09-10" });
    expect(backfillSnapshots(db, { today: "2026-09-27" })).toBe(2);
    const [first, second] = all();
    expect(first).toMatchObject({ date: "2020-01-01", partial: true, netWorth: 300_000 });
    expect(rowsOf(first.id).map((r) => r.accountId)).toEqual([house.id]);
    expect(second).toMatchObject({ date: "2026-09-01", partial: true, netWorth: 300_050 });

    // Net worth history skips partial days; the house's own history keeps them.
    expect(getNetWorthHistory(db, { range: "all", baseCurrency: "USD" }).map((p) => p.date)).toEqual(["2026-09-10"]);
    expect(getAccountHistory(db, house.id, { range: "all", baseCurrency: "USD" }).map((p) => p.date)).toEqual([
      "2020-01-01",
      "2026-09-01",
      "2026-09-10",
    ]);
  });

  it("only fills days before the earliest snapshot", () => {
    const cash = account({ name: "Cash", category: "Cash" });
    value(cash.id, 1, "USD", "2026-03-01");
    takeSnapshot(db, { date: "2026-02-01" });
    value(cash.id, 2, "USD", "2026-01-15");
    expect(backfillSnapshots(db, { today: "2026-09-27" })).toBe(1);
    expect(all().map((s) => [s.date, s.netWorth])).toEqual([
      ["2026-01-15", 2],
      ["2026-02-01", 1],
    ]);
    expect(backfillSnapshots(db, { today: "2026-09-27" })).toBe(0);
  });
});

describe("automatic capture", () => {
  const form = (values: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  };
  const latest = () => db.select().from(snapshots).where(eq(snapshots.date, localDate())).get();
  const redirected = (p: Promise<unknown>) => p.catch((err: { url?: string }) => err.url);

  beforeEach(() => {
    vi.mocked(recordSnapshot).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures after account, valuation, and holding changes", async () => {
    const actions = await import("@/lib/actions");
    await redirected(
      actions.createAccount({}, form({ name: "Checking", categoryId: category("Cash").id, kind: "value", currency: "USD", initialValue: "100" })),
    );
    expect(latest()?.netWorth).toBe(100);

    const checking = db.select().from(accounts).get()!;
    await actions.addValuation({}, form({ accountId: checking.id, date: "2999-01-01", value: "250" }));
    expect(latest()?.netWorth).toBe(250);

    await actions.updateAccount({}, form({ id: checking.id, name: "Checking", categoryId: category("Cash").id, currency: "USD", isExcluded: "on" }));
    expect(latest()?.netWorth).toBe(0);

    await redirected(actions.createAccount({}, form({ name: "Broker", categoryId: category("Investments").id, kind: "holdings", currency: "USD" })));
    const broker = db.select().from(accounts).where(eq(accounts.name, "Broker")).get()!;
    await actions.saveHolding({}, form({ accountId: broker.id, symbol: "VOO", name: "", type: "etf", quantity: "2", price: "50", marketValue: "", costBasis: "", currency: "USD" }));
    expect(latest()?.netWorth).toBe(100);

    const holding = db.select().from(holdings).get()!;
    await actions.deleteHolding(form({ id: holding.id }));
    expect(latest()?.netWorth).toBe(0);

    await redirected(actions.deleteAccount({}, form({ id: broker.id, confirm: "on" })));
    expect(rowsOf(latest()!.id).map((r) => r.accountId)).toEqual([checking.id]);
  });

  it("captures after a base currency change and manual FX rates", async () => {
    const { setBaseCurrency } = await import("@/lib/actions");
    const { saveManualRate, clearManualRateAction } = await import("@/lib/fx/actions");
    const eur = account({ name: "Euro", category: "Cash", currency: "EUR" });
    value(eur.id, 100, "EUR");

    await saveManualRate({}, form({ currency: "EUR", rate: "1.1" }));
    expect(latest()).toMatchObject({ baseCurrency: "USD", fxRates: JSON.stringify({ EUR: 1.1 }) });
    expect(latest()?.netWorth).toBeCloseTo(110);

    await setBaseCurrency({}, form({ baseCurrency: "EUR" }));
    expect(latest()).toMatchObject({ baseCurrency: "EUR", netWorth: 100 });

    await setBaseCurrency({}, form({ baseCurrency: "USD" }));
    await clearManualRateAction({}, form({ base: "EUR", quote: "USD" }));
    expect(latest()).toMatchObject({ baseCurrency: "USD", netWorth: 0, fxRates: "{}" });
  });

  it("captures after refreshing FX, prices, and a connection", async () => {
    const { refreshFxAction } = await import("@/lib/fx/actions");
    const { refreshPricesAction } = await import("@/lib/prices/actions");
    const { addConnection, refreshConnection } = await import("@/lib/connections/actions");
    const { connections } = await import("@/lib/db/schema");

    const broker = account({ name: "Broker", category: "Investments", kind: "holdings" });
    db.insert(holdings).values({ accountId: broker.id, symbol: "VOO", name: "VOO", quantity: 1, price: 1, marketValue: 1, currency: "USD" }).run();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "down" }, { status: 503 })));
    await refreshFxAction();
    expect(latest()?.netWorth).toBe(1);

    await refreshPricesAction();
    expect(latest()?.netWorth).toBe(999);

    await addConnection({}, form({ exchange: "kraken", name: "", apiKey: "k", secret: "s" }));
    expect(latest()?.netWorth).toBe(999 + 100_000);

    db.delete(snapshots).run();
    const conn = db.select().from(connections).get()!;
    await refreshConnection({}, form({ id: conn.id }));
    expect(latest()?.netWorth).toBe(999 + 100_000);
  });

  it("captures after applying an import", async () => {
    const { applyImport } = await import("@/lib/import/actions");
    const payload = {
      fileName: "Positions.csv",
      institution: null,
      asOf: "2026-09-01",
      accounts: [
        {
          target: "new",
          name: "Brokerage",
          categoryId: category("Investments").id,
          currency: "USD",
          mask: null,
          holdings: [{ symbol: "ACME", name: "ACME", type: "stock", quantity: 2, price: 10, marketValue: 20, costBasis: null }],
        },
      ],
    };
    const res = await applyImport({}, form({ payload: JSON.stringify(payload) }));
    expect(res.error).toBeUndefined();
    expect(latest()?.netWorth).toBe(20);
  });

  it("refreshAll takes one snapshot at the end", async () => {
    const { refreshAll } = await import("@/lib/refresh");
    const broker = account({ name: "Broker", category: "Investments", kind: "holdings" });
    db.insert(holdings).values({ accountId: broker.id, symbol: "VOO", name: "VOO", quantity: 1, price: 1, marketValue: 1, currency: "USD" }).run();

    await refreshAll();
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    expect(latest()?.netWorth).toBe(999);
  });

  it("never fails the user's action when the snapshot fails", async () => {
    const { addValuation } = await import("@/lib/actions");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cash = account({ name: "Checking", category: "Cash" });
    db.run(sql`DROP TABLE snapshot_accounts`);

    expect(await addValuation({}, form({ accountId: cash.id, date: "2026-09-01", value: "5" }))).toEqual({ ok: true });
    expect(db.select().from(valuations).all()).toHaveLength(1);
    expect(error).toHaveBeenCalledWith("Couldn't record net worth snapshot:", expect.any(Error));
    error.mockRestore();
  });
});
