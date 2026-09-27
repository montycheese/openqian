import type { Exchange } from "ccxt";
import type { ExchangeId, HoldingType } from "@/lib/db/schema";

export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  coinbase: "Coinbase",
  kraken: "Kraken",
  gemini: "Gemini",
  binanceus: "Binance.US",
};

export type ExchangeCredentials = { apiKey: string; secret: string };

export type ExchangePosition = {
  symbol: string;
  name: string;
  type: HoldingType;
  quantity: number;
  price: number | null;
  marketValue: number;
  currency: string;
};

const FIAT = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SGD", "HKD"]);
export const USD_STABLECOINS = new Set(["USDC", "USDT", "DAI", "PYUSD", "GUSD", "USDP", "FDUSD", "USDS"]);
const QUOTES = ["USD", "USDC", "USDT"];

/** Pasted private keys often arrive with literal "\n" sequences instead of newlines. */
export function normalizeCredentials(c: ExchangeCredentials): ExchangeCredentials {
  return { apiKey: c.apiKey.trim(), secret: c.secret.trim().replace(/\\n/g, "\n") };
}

export async function createExchange(id: ExchangeId, credentials: ExchangeCredentials): Promise<Exchange> {
  const ccxt = await import("ccxt");
  const ExchangeClass = ccxt[id] as unknown as new (config: object) => Exchange;
  return new ExchangeClass({ ...normalizeCredentials(credentials), enableRateLimit: true, timeout: 20_000 });
}

/**
 * Coinbase reports what a key may do. Returns the permissions beyond viewing,
 * or null when the exchange doesn't expose this.
 */
export async function excessPermissions(id: ExchangeId, exchange: Exchange): Promise<string[] | null> {
  if (id !== "coinbase") return null;
  const perms = (await (exchange as unknown as { v3PrivateGetBrokerageKeyPermissions(): Promise<Record<string, unknown>> })
    .v3PrivateGetBrokerageKeyPermissions()) as { can_trade?: boolean; can_transfer?: boolean };
  return [perms.can_trade && "trade", perms.can_transfer && "transfer"].filter((p): p is string => Boolean(p));
}

/** Turns balances and USD prices into positions. Pure, for testing. */
export function toPositions(
  totals: Record<string, number | undefined>,
  usdPrices: Record<string, number | null>,
  names: Record<string, string | undefined> = {},
): { positions: ExchangePosition[]; unpriced: string[] } {
  const positions: ExchangePosition[] = [];
  const unpriced: string[] = [];
  for (const [code, amount] of Object.entries(totals)) {
    if (!amount || amount <= 1e-12) continue;
    if (FIAT.has(code)) {
      positions.push({ symbol: code, name: `${code} cash`, type: "cash", quantity: amount, price: 1, marketValue: amount, currency: code });
      continue;
    }
    const price = USD_STABLECOINS.has(code) ? 1 : (usdPrices[code] ?? null);
    if (price === null) unpriced.push(code);
    positions.push({
      symbol: code,
      name: names[code] ?? code,
      type: "crypto",
      quantity: amount,
      price,
      marketValue: price === null ? 0 : amount * price,
      currency: "USD",
    });
  }
  positions.sort((a, b) => b.marketValue - a.marketValue);
  return { positions, unpriced };
}

/** Fetches balances and prices them in USD using the exchange's own markets. */
export async function fetchPositions(exchange: Exchange) {
  const balance = await exchange.fetchBalance();
  const totals = (balance.total ?? {}) as unknown as Record<string, number | undefined>;
  const held = Object.keys(totals).filter(
    (c) => (totals[c] ?? 0) > 1e-12 && !FIAT.has(c) && !USD_STABLECOINS.has(c),
  );

  const usdPrices: Record<string, number | null> = {};
  if (held.length > 0) {
    const markets = await exchange.loadMarkets();
    const symbolFor = new Map<string, string>();
    for (const code of held) {
      const symbol = QUOTES.map((q) => `${code}/${q}`).find((s) => markets[s]);
      if (symbol) symbolFor.set(code, symbol);
    }
    const symbols = [...symbolFor.values()];
    const tickers =
      symbols.length === 0
        ? {}
        : exchange.has.fetchTickers
          ? await exchange.fetchTickers(symbols)
          : Object.fromEntries(await Promise.all(symbols.map(async (s) => [s, await exchange.fetchTicker(s)])));
    for (const code of held) {
      const t = tickers[symbolFor.get(code) ?? ""];
      usdPrices[code] = t?.last ?? t?.close ?? null;
    }
  }

  const names = Object.fromEntries(
    Object.entries(exchange.currencies ?? {}).map(([code, c]) => [code, c?.name ?? undefined]),
  );
  return toPositions(totals, usdPrices, names);
}
