import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { accounts, categories, holdings, prices, type HoldingType } from "@/lib/db/schema";
import { refreshPrices, type PriceKind, type PriceProvider, type Quote } from "@/lib/prices";

let db: DB;

function fakeProvider(kind: PriceKind, table: Record<string, number>, currency = "USD") {
  const provider = {
    id: `fake-${kind}`,
    label: `Fake ${kind}`,
    kind,
    fetchQuotes: vi.fn(async (symbols: string[]) => {
      const out = new Map<string, Quote>();
      for (const s of symbols) if (table[s] !== undefined) out.set(s, { price: table[s], currency, date: "2026-09-25" });
      return out;
    }),
  } satisfies PriceProvider;
  return provider;
}

const failing = (kind: PriceKind): PriceProvider => ({
  id: `down-${kind}`,
  label: kind === "crypto" ? "CoinGecko" : "Yahoo Finance",
  kind,
  fetchQuotes: async () => {
    throw new TypeError("fetch failed");
  },
});

function account(source: "manual" | "import" | "connection" = "manual") {
  const category = db.select().from(categories).where(eq(categories.name, "Investments")).get()!;
  return db
    .insert(accounts)
    .values({ name: `${source} account`, categoryId: category.id, kind: "holdings", currency: "USD", source })
    .returning()
    .get().id;
}

function holding(accountId: string, symbol: string | null, type: HoldingType, quantity: number | null, marketValue = 1) {
  return db
    .insert(holdings)
    .values({ accountId, symbol, name: symbol ?? "Cash", type, quantity, price: null, marketValue, currency: "USD" })
    .returning()
    .get().id;
}

const get = (id: string) => db.select().from(holdings).where(eq(holdings.id, id)).get()!;

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("refreshPrices", () => {
  it("revalues eligible holdings and records quotes", async () => {
    const acct = account("import");
    const voo = holding(acct, "VOO", "etf", 10);
    const brk = holding(acct, "brk.b", "stock", 2);
    const btc = holding(acct, "BTC", "crypto", 0.5);
    const securities = fakeProvider("security", { VOO: 500, "BRK.B": 450 });
    const crypto = fakeProvider("crypto", { BTC: 100_000 });

    const result = await refreshPrices(db, { security: securities, crypto });

    expect(result).toEqual({ updated: 3, unpriced: [], errors: [] });
    expect(get(voo)).toMatchObject({ price: 500, marketValue: 5000, currency: "USD", priceSource: "feed" });
    expect(get(voo).priceAsOf).toBeInstanceOf(Date);
    expect(get(brk)).toMatchObject({ price: 450, marketValue: 900 });
    expect(get(btc)).toMatchObject({ price: 100_000, marketValue: 50_000 });
    expect(securities.fetchQuotes).toHaveBeenCalledWith(["VOO", "BRK.B"]);
    expect(crypto.fetchQuotes).toHaveBeenCalledWith(["BTC"]);

    const rows = db.select().from(prices).all();
    expect(rows.map((p) => [p.symbol, p.kind, p.date, p.price, p.source])).toEqual([
      ["VOO", "security", "2026-09-25", 500, "fake-security"],
      ["BRK.B", "security", "2026-09-25", 450, "fake-security"],
      ["BTC", "crypto", "2026-09-25", 100_000, "fake-crypto"],
    ]);
  });

  it("skips connected accounts, cash and other non-market types, and rows without a symbol or quantity", async () => {
    const manual = account("manual");
    const connected = account("connection");
    const exchangeBtc = holding(connected, "BTC", "crypto", 1, 123);
    const cash = holding(manual, "SPAXX", "cash", 100, 100);
    const bond = holding(manual, "912828XX", "bond", 1, 1000);
    const valueOnly = holding(manual, "VTI", "fund", null, 777);
    const noSymbol = holding(manual, null, "stock", 3, 30);
    const securities = fakeProvider("security", { SPAXX: 1, "912828XX": 99, VTI: 250 });
    const crypto = fakeProvider("crypto", { BTC: 100_000 });

    const result = await refreshPrices(db, { security: securities, crypto });

    expect(result).toEqual({ updated: 0, unpriced: [], errors: [] });
    expect(securities.fetchQuotes).not.toHaveBeenCalled();
    expect(crypto.fetchQuotes).not.toHaveBeenCalled();
    expect(get(exchangeBtc).marketValue).toBe(123);
    expect(get(cash).priceSource).toBe("manual");
    expect(get(bond).marketValue).toBe(1000);
    expect(get(valueOnly).marketValue).toBe(777);
    expect(get(noSymbol).marketValue).toBe(30);
  });

  it("dedupes symbols across accounts and updates every matching holding", async () => {
    const a = holding(account(), "AAPL", "stock", 1);
    const b = holding(account("import"), "AAPL", "stock", 3);
    const securities = fakeProvider("security", { AAPL: 200 });
    await refreshPrices(db, { security: securities, crypto: fakeProvider("crypto", {}) });
    expect(securities.fetchQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect([get(a).marketValue, get(b).marketValue]).toEqual([200, 600]);
  });

  it("reports symbols without a quote and leaves those holdings untouched", async () => {
    const acct = account();
    const known = holding(acct, "VOO", "etf", 1);
    const unknown = holding(acct, "ZZZZ", "stock", 5, 42);
    const result = await refreshPrices(db, { security: fakeProvider("security", { VOO: 500 }), crypto: fakeProvider("crypto", {}) });
    expect(result).toEqual({ updated: 1, unpriced: ["ZZZZ"], errors: [] });
    expect(get(known).marketValue).toBe(500);
    expect(get(unknown)).toMatchObject({ marketValue: 42, priceSource: "manual", priceAsOf: null });
  });

  it("isolates a failing provider and keeps going with the other", async () => {
    const acct = account();
    const voo = holding(acct, "VOO", "etf", 2, 10);
    const btc = holding(acct, "BTC", "crypto", 1);

    const result = await refreshPrices(db, { security: failing("security"), crypto: fakeProvider("crypto", { BTC: 90_000 }) });

    expect(result.updated).toBe(1);
    expect(result.unpriced).toEqual([]);
    expect(result.errors).toEqual(["Yahoo Finance: couldn't connect; check your internet connection"]);
    expect(get(voo).marketValue).toBe(10);
    expect(get(btc).marketValue).toBe(90_000);
  });

  it("prices USD stablecoins at 1 without calling the crypto provider", async () => {
    const acct = account();
    const usdc = holding(acct, "USDC", "crypto", 250);
    const crypto = fakeProvider("crypto", {});
    const result = await refreshPrices(db, { security: fakeProvider("security", {}), crypto: { ...crypto, fetchQuotes: failing("crypto").fetchQuotes } });
    expect(result).toEqual({ updated: 1, unpriced: [], errors: [] });
    expect(get(usdc)).toMatchObject({ price: 1, marketValue: 250, currency: "USD", priceSource: "feed" });
    expect(db.select().from(prices).get()).toMatchObject({ symbol: "USDC", source: "peg" });
  });

  it("takes the quote's currency and upserts the price cache on repeat", async () => {
    const acct = account();
    const shop = holding(acct, "SHOP.TO", "stock", 10);
    const run = (price: number) =>
      refreshPrices(db, { security: fakeProvider("security", { "SHOP.TO": price }, "CAD"), crypto: fakeProvider("crypto", {}) });
    await run(200);
    await run(201);
    expect(get(shop)).toMatchObject({ price: 201, marketValue: 2010, currency: "CAD" });
    const rows = db.select().from(prices).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: 201, currency: "CAD" });
  });
});
