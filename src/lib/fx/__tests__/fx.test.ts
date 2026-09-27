import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { accounts, categories, fxRates, holdings, settings } from "@/lib/db/schema";
import { clearManualRate, listRates, loadConverter, refreshFxRates, setManualRate } from "@/lib/fx";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

function rate(base: string, quote: string, value: number, source: "frankfurter" | "manual" = "frankfurter", date = "2026-01-02") {
  db.insert(fxRates).values({ date, base, quote, rate: value, source }).run();
}

function account(currency: string) {
  const cat = db.select().from(categories).all()[0];
  return db.insert(accounts).values({ name: currency, categoryId: cat.id, kind: "holdings", currency }).returning().get();
}

describe("loadConverter", () => {
  it("returns amounts in the base currency unchanged", () => {
    expect(loadConverter(db, "USD")(100, "USD")).toBe(100);
  });

  it("returns null when no rate is known", () => {
    expect(loadConverter(db, "USD")(100, "EUR")).toBeNull();
  });

  it("uses inverse of rates stored against the base", () => {
    rate("USD", "EUR", 0.8);
    expect(loadConverter(db, "USD")(80, "EUR")).toBeCloseTo(100);
  });

  it("uses rates stored with the currency as base directly", () => {
    rate("EUR", "USD", 1.25);
    expect(loadConverter(db, "USD")(80, "EUR")).toBeCloseTo(100);
  });

  it("crosses through a previous base after the base changes", () => {
    rate("USD", "EUR", 0.8);
    rate("USD", "GBP", 0.5);
    const convert = loadConverter(db, "EUR");
    expect(convert(1, "USD")).toBeCloseTo(0.8);
    // 1 GBP = 2 USD = 1.6 EUR
    expect(convert(1, "GBP")).toBeCloseTo(1.6);
  });

  it("uses the newest fetched rate", () => {
    rate("USD", "EUR", 0.5, "frankfurter", "2026-01-01");
    rate("USD", "EUR", 0.8, "frankfurter", "2026-01-02");
    expect(loadConverter(db, "USD")(80, "EUR")).toBeCloseTo(100);
  });

  it("prefers manual rates over newer fetched ones", () => {
    rate("USD", "EUR", 0.8, "frankfurter", "2026-02-01");
    rate("EUR", "USD", 2, "manual", "2026-01-01");
    expect(loadConverter(db, "USD")(10, "EUR")).toBeCloseTo(20);
  });

  it("prefers a manual rate crossed through another base over a fetched direct rate", () => {
    rate("USD", "EUR", 0.8);
    rate("EUR", "TWD", 40); // fetched after switching base to EUR
    setManualRate(db, "TWD", "USD", 0.05); // set while base was USD
    // 1 TWD = 0.05 USD = 0.04 EUR
    expect(loadConverter(db, "EUR")(1, "TWD")).toBeCloseTo(0.04);
  });
});

describe("manual rates", () => {
  it("replaces earlier overrides for the pair and can be cleared", () => {
    setManualRate(db, "EUR", "USD", 1.1);
    setManualRate(db, "USD", "EUR", 0.5);
    expect(db.select().from(fxRates).all()).toMatchObject([{ base: "USD", quote: "EUR", rate: 0.5, source: "manual" }]);
    rate("USD", "EUR", 0.8);
    clearManualRate(db, "EUR", "USD");
    expect(db.select().from(fxRates).all()).toMatchObject([{ source: "frankfurter" }]);
  });
});

describe("listRates", () => {
  it("reports each non-base currency in use", () => {
    account("USD");
    account("EUR");
    const acct = account("GBP");
    db.insert(holdings).values({ accountId: acct.id, name: "Toyota", marketValue: 1, currency: "JPY" }).run();
    rate("USD", "EUR", 0.8, "frankfurter", "2026-03-01");
    setManualRate(db, "GBP", "USD", 1.3);

    const rows = listRates(db, "USD");
    expect(rows.map((r) => r.currency)).toEqual(["EUR", "GBP", "JPY"]);
    expect(rows[0]).toMatchObject({ source: "frankfurter", date: "2026-03-01", missing: false, manualPair: null });
    expect(rows[0].rate).toBeCloseTo(1.25);
    expect(rows[1]).toMatchObject({ rate: 1.3, source: "manual", manualPair: { base: "GBP", quote: "USD" } });
    expect(rows[2]).toMatchObject({ rate: null, missing: true });
  });
});

describe("refreshFxRates", () => {
  const currencies = [{ iso_code: "USD" }, { iso_code: "EUR" }, { iso_code: "GBP" }];
  function mockFetch(rates: Record<string, number>, date = "2026-09-25") {
    return vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/currencies")) return Response.json(currencies);
      const base = u.searchParams.get("base")!;
      const quotes = u.searchParams.get("quotes")!.split(",");
      return Response.json(quotes.map((quote) => ({ date, base, quote, rate: rates[quote] })));
    }) as unknown as typeof fetch;
  }

  it("does nothing when every currency is the base", async () => {
    account("USD");
    const fetchImpl = mockFetch({});
    expect(await refreshFxRates(db, fetchImpl)).toEqual({ currencies: [], unsupported: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stores rates idempotently and reports unsupported currencies", async () => {
    account("EUR");
    account("GBP");
    account("XAU");
    const fetchImpl = mockFetch({ EUR: 0.8, GBP: 0.75 });

    expect(await refreshFxRates(db, fetchImpl)).toEqual({ currencies: ["EUR", "GBP"], unsupported: ["XAU"] });
    expect(String(vi.mocked(fetchImpl).mock.calls[1][0])).toBe("https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,GBP");

    await refreshFxRates(db, mockFetch({ EUR: 0.9, GBP: 0.75 }));
    const rows = db.select().from(fxRates).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.quote === "EUR")).toMatchObject({ base: "USD", rate: 0.9, date: "2026-09-25", source: "frankfurter" });
  });

  it("fetches against the current base currency", async () => {
    db.insert(settings).values({ key: "base_currency", value: "EUR" }).run();
    account("USD");
    const fetchImpl = mockFetch({ USD: 1.1 });
    await refreshFxRates(db, fetchImpl);
    expect(db.select().from(fxRates).all()).toMatchObject([{ base: "EUR", quote: "USD", rate: 1.1 }]);
  });

  it("returns an error instead of throwing on network failure", async () => {
    account("EUR");
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await refreshFxRates(db, fetchImpl)).toEqual({ currencies: [], unsupported: [], error: "fetch failed" });
    expect(db.select().from(fxRates).all()).toEqual([]);
  });

  it("reports HTTP errors", async () => {
    account("EUR");
    const fetchImpl = vi.fn(async () => Response.json({ status: 503, message: "down" }, { status: 503 })) as unknown as typeof fetch;
    expect((await refreshFxRates(db, fetchImpl)).error).toBe("Frankfurter returned 503: down");
  });
});
