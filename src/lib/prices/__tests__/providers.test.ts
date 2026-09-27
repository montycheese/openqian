import { describe, expect, it, vi } from "vitest";
import { COINGECKO_IDS, createCoinGeckoProvider } from "@/lib/prices/coingecko";
import { normalizeQuoteCurrency, parseYahooQuotes, toYahooSymbol } from "@/lib/prices/yahoo";

describe("toYahooSymbol", () => {
  it("maps share classes to Yahoo's dash form and keeps exchange suffixes", () => {
    expect(toYahooSymbol("BRK.B")).toBe("BRK-B");
    expect(toYahooSymbol("brk/a")).toBe("BRK-A");
    expect(toYahooSymbol("BF B")).toBe("BF-B");
    expect(toYahooSymbol("VOD.L")).toBe("VOD.L");
    expect(toYahooSymbol("SHOP.TO")).toBe("SHOP.TO");
    expect(toYahooSymbol("7203.T")).toBe("7203.T");
    expect(toYahooSymbol(" voo ")).toBe("VOO");
  });
});

describe("parseYahooQuotes", () => {
  const symbolFor = new Map([
    ["BRK-B", "BRK.B"],
    ["VOD.L", "VOD.L"],
    ["BAD", "BAD"],
  ]);

  it("keys quotes by the caller's symbol, converts pence, and skips malformed items", () => {
    const quotes = parseYahooQuotes(
      [
        { symbol: "BRK-B", regularMarketPrice: 500, currency: "USD", regularMarketTime: "2026-09-25T20:00:00Z", exchangeTimezoneName: "America/New_York" },
        { symbol: "VOD.L", regularMarketPrice: 125.8, currency: "GBp", regularMarketTime: "2026-09-25T16:00:00Z" },
        { symbol: "BAD", currency: "USD" },
        { symbol: "UNASKED", regularMarketPrice: 1, currency: "USD" },
      ],
      symbolFor,
    );
    expect([...quotes.keys()]).toEqual(["BRK.B", "VOD.L"]);
    expect(quotes.get("BRK.B")).toEqual({ price: 500, currency: "USD", date: "2026-09-25" });
    expect(quotes.get("VOD.L")).toEqual({ price: 1.258, currency: "GBP", date: "2026-09-25" });
  });

  it("dates a quote in the exchange's time zone", () => {
    // 00:08 UTC on the 26th is still the 25th in New York.
    const quotes = parseYahooQuotes(
      [{ symbol: "BAD", regularMarketPrice: 47, currency: "USD", regularMarketTime: "2026-09-26T00:08:30Z", exchangeTimezoneName: "America/New_York" }],
      symbolFor,
    );
    expect(quotes.get("BAD")?.date).toBe("2026-09-25");
  });

  it("tolerates a non-array response", () => {
    expect(parseYahooQuotes(undefined, symbolFor).size).toBe(0);
  });
});

describe("normalizeQuoteCurrency", () => {
  it("converts minor units", () => {
    expect(normalizeQuoteCurrency(250, "ZAc")).toEqual({ price: 2.5, currency: "ZAR" });
    expect(normalizeQuoteCurrency(10, "usd")).toEqual({ price: 10, currency: "USD" });
  });
});

describe("CoinGecko provider", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("uses pinned ids for known tickers and a symbol lookup for the rest", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids")) {
        return json({ bitcoin: { usd: 100_000, last_updated_at: Date.parse("2026-09-27T12:00:00Z") / 1000 }, uniswap: { usd: 9.5 } });
      }
      return json({ wif: { usd: 0.25 } });
    });
    const quotes = await createCoinGeckoProvider(fetchImpl as typeof fetch).fetchQuotes(["BTC", "UNI", "WIF", "NOPE"]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [idsUrl, symbolsUrl] = fetchImpl.mock.calls.map(([u]) => new URL(String(u)));
    expect(idsUrl.searchParams.get("ids")).toBe("bitcoin,uniswap");
    expect(symbolsUrl.searchParams.get("symbols")).toBe("wif,nope");
    expect(quotes.get("BTC")).toEqual({ price: 100_000, currency: "USD", date: "2026-09-27" });
    expect(quotes.get("UNI")?.price).toBe(9.5);
    expect(quotes.get("WIF")?.price).toBe(0.25);
    expect(quotes.has("NOPE")).toBe(false);
  });

  it("skips the symbol lookup when every ticker is pinned", async () => {
    const fetchImpl = vi.fn(async () => json({ ethereum: { usd: 4000 } }));
    await createCoinGeckoProvider(fetchImpl as unknown as typeof fetch).fetchQuotes(["ETH"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error when rate limited", async () => {
    const provider = createCoinGeckoProvider((async () => json({}, 429)) as unknown as typeof fetch);
    await expect(provider.fetchQuotes(["BTC"])).rejects.toThrow(/rate limit/);
  });

  it("pins the most common tickers", () => {
    expect(COINGECKO_IDS.BTC).toBe("bitcoin");
    expect(Object.keys(COINGECKO_IDS).length).toBeGreaterThanOrEqual(30);
  });
});
