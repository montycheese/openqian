import { z } from "zod";
import { isoDate, type PriceProvider, type Quote } from "./types";

// Single-letter Yahoo exchange suffixes, e.g. VOD.L (London), 7203.T (Tokyo).
const EXCHANGE_SUFFIXES = new Set(["L", "F", "V", "T"]);

/** Share classes are written "BRK.B", "BRK/B" or "BRK B" by brokers; Yahoo uses "BRK-B". */
export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const m = /^([A-Z]+)[./ ]([A-Z])$/.exec(s);
  if (m && !(s.includes(".") && EXCHANGE_SUFFIXES.has(m[2]))) return `${m[1]}-${m[2]}`;
  return s;
}

// Yahoo quotes some exchanges in minor units (pence, cents, agorot).
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ZAC: "ZAR", ILA: "ILS" };

/** Converts minor-unit prices to their major currency. */
export function normalizeQuoteCurrency(price: number, currency: string): { price: number; currency: string } {
  const major = MINOR_UNITS[currency];
  return major ? { price: price / 100, currency: major } : { price, currency: currency.toUpperCase() };
}

const yahooQuote = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number().positive().finite(),
  currency: z.string().min(3),
  regularMarketTime: z.coerce.date().optional(),
  exchangeTimezoneName: z.string().optional(),
});

/** Picks usable quotes out of Yahoo's raw response, keyed by the caller's symbols. */
export function parseYahooQuotes(raw: unknown, symbolFor: Map<string, string>, now = new Date()): Map<string, Quote> {
  const quotes = new Map<string, Quote>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const parsed = yahooQuote.safeParse(item);
    if (!parsed.success) continue;
    const q = parsed.data;
    const symbol = symbolFor.get(q.symbol.toUpperCase());
    if (!symbol) continue;
    const at = q.regularMarketTime && !Number.isNaN(q.regularMarketTime.getTime()) ? q.regularMarketTime : now;
    quotes.set(symbol, { ...normalizeQuoteCurrency(q.regularMarketPrice, q.currency), date: isoDate(at, q.exchangeTimezoneName) });
  }
  return quotes;
}

type YahooClient = { quote(symbols: string[], query: object, module: { validateResult: false }): Promise<unknown> };
let client: Promise<YahooClient> | undefined;

// Imported lazily so the package only loads when prices are actually refreshed.
function getClient(): Promise<YahooClient> {
  client ??= import("yahoo-finance2").then(
    ({ default: YahooFinance }) =>
      new YahooFinance({ suppressNotices: ["yahooSurvey"], versionCheck: false }) as unknown as YahooClient,
  );
  return client;
}

const BATCH = 50;

export const yahooProvider: PriceProvider = {
  id: "yahoo",
  label: "Yahoo Finance",
  kind: "security",
  async fetchQuotes(symbols) {
    const symbolFor = new Map(symbols.map((s) => [toYahooSymbol(s), s]));
    const yahooSymbols = [...symbolFor.keys()];
    const yf = await getClient();
    const quotes = new Map<string, Quote>();
    for (let i = 0; i < yahooSymbols.length; i += BATCH) {
      // Unknown symbols are just missing from the response. Validation is done
      // here per item so one odd quote can't fail the whole batch.
      const raw = await yf.quote(
        yahooSymbols.slice(i, i + BATCH),
        { return: "array", fields: ["symbol", "regularMarketPrice", "currency", "regularMarketTime", "exchangeTimezoneName"] },
        { validateResult: false },
      );
      for (const [symbol, quote] of parseYahooQuotes(raw, symbolFor)) quotes.set(symbol, quote);
    }
    return quotes;
  },
};
