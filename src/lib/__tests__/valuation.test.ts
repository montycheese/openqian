import { describe, expect, it } from "vitest";
import type { Account, Category, Holding, Valuation } from "@/lib/db/schema";
import { sameCurrencyConverter } from "@/lib/money";
import { latestValuations, summarizeNetWorth } from "@/lib/valuation";

const now = new Date("2026-09-01T00:00:00Z");
const cat = (id: string, kind: "asset" | "debt", sortOrder = 0): Category => ({ id, name: id, kind, sortOrder });
const account = (id: string, categoryId: string, over: Partial<Account> = {}): Account => ({
  id,
  name: id,
  institution: null,
  categoryId,
  kind: "value",
  currency: "USD",
  source: "manual",
  accountMask: null,
  notes: null,
  isHidden: false,
  isExcluded: false,
  createdAt: now,
  updatedAt: now,
  ...over,
});
const valuation = (accountId: string, date: string, value: number, over: Partial<Valuation> = {}): Valuation => ({
  id: `${accountId}-${date}-${value}`,
  accountId,
  date,
  value,
  quantity: null,
  unitPrice: null,
  currency: "USD",
  note: null,
  createdAt: now,
  ...over,
});
const holding = (accountId: string, marketValue: number, over: Partial<Holding> = {}): Holding => ({
  id: `${accountId}-${marketValue}`,
  accountId,
  symbol: "VOO",
  name: "Vanguard S&P 500",
  cusip: null,
  type: "etf",
  quantity: 1,
  price: marketValue,
  marketValue,
  currency: "USD",
  costBasis: null,
  network: null,
  priceSource: "manual",
  priceAsOf: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

describe("latestValuations", () => {
  it("picks the newest date, then the newest entry on that date", () => {
    const later = new Date(now.getTime() + 1000);
    const latest = latestValuations([
      valuation("a", "2026-01-01", 1),
      valuation("a", "2026-03-01", 2),
      valuation("a", "2026-03-01", 3, { createdAt: later }),
      valuation("a", "2026-02-01", 4),
    ]);
    expect(latest.get("a")?.value).toBe(3);
  });
});

describe("summarizeNetWorth", () => {
  const categories = [cat("cash", "asset", 0), cat("invest", "asset", 1), cat("loans", "debt", 2)];

  it("adds assets, subtracts debts", () => {
    const s = summarizeNetWorth({
      baseCurrency: "USD",
      categories,
      accounts: [account("checking", "cash"), account("brokerage", "invest", { kind: "holdings" }), account("car", "loans")],
      valuations: [valuation("checking", "2026-09-01", 1000), valuation("car", "2026-09-01", 300)],
      holdings: [holding("brokerage", 500), holding("brokerage", 250)],
      convert: sameCurrencyConverter("USD"),
    });
    expect(s.assets).toBe(1750);
    expect(s.debts).toBe(300);
    expect(s.netWorth).toBe(1450);
    expect(s.categories.map((c) => c.total)).toEqual([1000, 750, 300]);
  });

  it("omits excluded and hidden accounts from totals", () => {
    const s = summarizeNetWorth({
      baseCurrency: "USD",
      categories,
      accounts: [
        account("a", "cash"),
        account("b", "cash", { isExcluded: true }),
        account("c", "cash", { isHidden: true }),
      ],
      valuations: [valuation("a", "2026-09-01", 10), valuation("b", "2026-09-01", 20), valuation("c", "2026-09-01", 40)],
      holdings: [],
      convert: sameCurrencyConverter("USD"),
    });
    expect(s.netWorth).toBe(10);
    expect(s.hiddenCount).toBe(1);
    expect(s.categories[0].accounts.map((a) => a.account.id)).toEqual(["b", "a"]);
  });

  it("reports currencies it cannot convert", () => {
    const s = summarizeNetWorth({
      baseCurrency: "USD",
      categories,
      accounts: [account("eur", "cash", { currency: "EUR" }), account("usd", "cash")],
      valuations: [valuation("eur", "2026-09-01", 100, { currency: "EUR" }), valuation("usd", "2026-09-01", 5)],
      holdings: [],
      convert: sameCurrencyConverter("USD"),
    });
    expect(s.netWorth).toBe(5);
    expect(s.missingRates).toEqual(["EUR"]);
  });

  it("leaves native value empty when holdings span currencies", () => {
    const s = summarizeNetWorth({
      baseCurrency: "USD",
      categories,
      accounts: [account("mixed", "invest", { kind: "holdings" })],
      valuations: [],
      holdings: [holding("mixed", 100), holding("mixed", 50, { currency: "EUR" })],
      convert: (amount, currency) => (currency === "EUR" ? amount * 2 : amount),
    });
    const summary = s.categories[1].accounts[0];
    expect(summary.native).toBeNull();
    expect(summary.base).toBe(200);
  });
});

describe("formatMoney", () => {
  it("drops cents for headline figures and never prints negative zero", async () => {
    const { formatMoney } = await import("@/lib/money");
    expect(formatMoney(1_310_230.21, "USD", { whole: true })).toBe("$1,310,230");
    expect(formatMoney(-0, "USD")).toBe("$0.00");
    expect(formatMoney(12.5, "USD")).toBe("$12.50");
  });
});
