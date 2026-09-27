import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";

let db: DB;

vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>();
  return { ...mod, getDb: () => db };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const actions = await import("@/lib/actions");
const { accounts, categories, holdings, valuations } = await import("@/lib/db/schema");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function redirectsTo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { url: string }).url;
  }
  throw new Error("expected redirect");
}

const category = (name: string) => db.select().from(categories).all().find((c) => c.name === name)!;

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("accounts", () => {
  it("creates a value account with an initial valuation", async () => {
    const url = await redirectsTo(
      actions.createAccount({}, form({ name: "Checking", categoryId: category("Cash").id, kind: "value", currency: "usd", initialValue: "1234.5" })),
    );
    const [acct] = db.select().from(accounts).all();
    expect(url).toBe(`/accounts/${acct.id}`);
    expect(acct.currency).toBe("USD");
    expect(db.select().from(valuations).all()).toMatchObject([{ value: 1234.5, currency: "USD" }]);
  });

  it("rejects holdings accounts in debt categories", async () => {
    const res = await actions.createAccount({}, form({ name: "X", categoryId: category("Loans").id, kind: "holdings", currency: "USD" }));
    expect(res.error).toMatch(/Debts/);
  });

  it("validates required fields", async () => {
    const res = await actions.createAccount({}, form({ name: " ", categoryId: category("Cash").id, kind: "value", currency: "USD" }));
    expect(res.error).toBe("Name is required");
  });

  it("updates flags and requires confirmation to delete", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "Car", categoryId: category("Other Assets").id, kind: "value", currency: "USD" })));
    const { id } = db.select().from(accounts).get()!;
    const res = await actions.updateAccount({}, form({ id, name: "Car", categoryId: category("Other Assets").id, currency: "USD", isExcluded: "on" }));
    expect(res.ok).toBe(true);
    expect(db.select().from(accounts).get()).toMatchObject({ isExcluded: true, isHidden: false });

    expect((await actions.deleteAccount({}, form({ id }))).error).toMatch(/confirm/);
    await redirectsTo(actions.deleteAccount({}, form({ id, confirm: "on" })));
    expect(db.select().from(accounts).all()).toHaveLength(0);
  });
});

describe("valuations", () => {
  it("computes value from quantity × unit price", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "Startup", categoryId: category("Private Equity").id, kind: "value", currency: "USD" })));
    const { id } = db.select().from(accounts).get()!;
    const res = await actions.addValuation({}, form({ accountId: id, date: "2026-09-01", value: "", quantity: "10000", unitPrice: "2.5", note: "Series B" }));
    expect(res.ok).toBe(true);
    expect(db.select().from(valuations).get()).toMatchObject({ value: 25000, quantity: 10000, unitPrice: 2.5, note: "Series B" });
  });

  it("requires a value", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "House", categoryId: category("Real Estate").id, kind: "value", currency: "USD" })));
    const { id } = db.select().from(accounts).get()!;
    expect((await actions.addValuation({}, form({ accountId: id, date: "2026-09-01", value: "" }))).error).toMatch(/Enter a value/);
  });
});

describe("holdings", () => {
  it("adds, edits, and removes positions", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "Brokerage", categoryId: category("Investments").id, kind: "holdings", currency: "USD" })));
    const { id: accountId } = db.select().from(accounts).get()!;

    await actions.saveHolding({}, form({ accountId, symbol: "voo", name: "", type: "etf", quantity: "2", price: "500", marketValue: "", costBasis: "", currency: "USD" }));
    await actions.saveHolding({}, form({ accountId, symbol: "", name: "Cash sweep", type: "cash", quantity: "", price: "", marketValue: "12.34", costBasis: "", currency: "USD" }));
    const voo = db.select().from(holdings).all().find((h) => h.symbol === "VOO")!;
    expect(voo).toMatchObject({ name: "VOO", marketValue: 1000 });

    await actions.saveHolding({}, form({ id: voo.id, accountId, symbol: "VOO", name: "Vanguard S&P 500", type: "etf", quantity: "3", price: "500", marketValue: "", costBasis: "900", currency: "USD" }));
    expect(db.select().from(holdings).all().find((h) => h.id === voo.id)).toMatchObject({ marketValue: 1500, costBasis: 900 });

    await actions.deleteHolding(form({ id: voo.id }));
    expect(db.select().from(holdings).all().map((h) => h.name)).toEqual(["Cash sweep"]);
  });

  it("needs quantity and price or a market value", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "B", categoryId: category("Investments").id, kind: "holdings", currency: "USD" })));
    const { id: accountId } = db.select().from(accounts).get()!;
    const res = await actions.saveHolding({}, form({ accountId, symbol: "AAPL", type: "stock", quantity: "1", price: "", marketValue: "", currency: "USD" }));
    expect(res.error).toMatch(/quantity and price/);
  });
});

describe("categories", () => {
  it("won't delete a category that has accounts", async () => {
    await redirectsTo(actions.createAccount({}, form({ name: "Checking", categoryId: category("Cash").id, kind: "value", currency: "USD" })));
    expect((await actions.deleteCategory({}, form({ id: category("Cash").id }))).error).toMatch(/Move or delete/);
    expect((await actions.deleteCategory({}, form({ id: category("Mortgages").id }))).ok).toBe(true);
  });
});
