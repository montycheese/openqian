import { z } from "zod";
import { USD_STABLECOINS } from "@/lib/connections/exchange";
import type { ChainBalance } from "./types";

const API = "https://api.coingecko.com/api/v3";

const usdPrices = z.record(z.string(), z.object({ usd: z.number().nonnegative().finite().optional() }));

/** Symbol → USD from Coinbase's public market data (no key), for when CoinGecko is unavailable. */
export type FallbackPricer = (symbols: string[]) => Promise<Map<string, number>>;

export const coinbaseTickers: FallbackPricer = async (symbols) => {
  const { createExchange } = await import("@/lib/connections/exchange");
  const exchange = await createExchange("coinbase", { apiKey: "", secret: "" });
  const markets = await exchange.loadMarkets();
  const pairs = symbols.map((s) => [s, `${s}/USD`] as const).filter(([, pair]) => markets[pair]);
  const found = new Map<string, number>();
  if (pairs.length === 0) return found;
  const tickers = await exchange.fetchTickers(pairs.map(([, pair]) => pair));
  for (const [symbol, pair] of pairs) {
    const last = tickers[pair]?.last;
    if (last) found.set(symbol, last);
  }
  return found;
};

/**
 * USD prices keyed by CoinGecko id, in one batched request. Only curated tokens
 * (which carry an id) are priced: wallets hold thousands of spam airdrops, and
 * CoinGecko's free tier allows a single contract lookup per request, so pricing
 * unknown tokens by contract would hit its rate limit on every refresh.
 * Stablecoins are pegged at $1. Failures are returned, not thrown.
 */
export async function priceBalances(
  balances: ChainBalance[],
  fetchImpl: typeof fetch = fetch,
  fallback: FallbackPricer = coinbaseTickers,
) {
  const prices = new Map<string, number>();
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const b of balances) {
    if (!b.coingeckoId) continue;
    if (USD_STABLECOINS.has(b.symbol.toUpperCase())) prices.set(b.coingeckoId, 1);
    else ids.add(b.coingeckoId);
  }
  if (ids.size === 0) return { prices, errors };

  try {
    const res = await fetchImpl(`${API}/simple/price?ids=${[...ids].join(",")}&vs_currencies=usd`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) throw new Error("CoinGecko rate limit reached; try again in a minute");
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = usdPrices.parse(await res.json());
    for (const id of ids) if (data[id]?.usd !== undefined) prices.set(id, data[id].usd!);
  } catch (err) {
    errors.push(`CoinGecko: ${err instanceof Error ? err.message : String(err)}`);
  }

  const missing = balances.filter((b) => b.coingeckoId && !prices.has(b.coingeckoId));
  if (missing.length > 0) {
    try {
      const bySymbol = await fallback([...new Set(missing.map((b) => b.symbol.toUpperCase()))]);
      for (const b of missing) {
        const price = bySymbol.get(b.symbol.toUpperCase());
        if (price !== undefined) prices.set(b.coingeckoId!, price);
      }
    } catch (err) {
      errors.push(`Coinbase: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Only worth mentioning if something is still unpriced.
  const unpriced = balances.some((b) => b.coingeckoId && !prices.has(b.coingeckoId));
  return { prices, errors: unpriced ? errors.map((e) => `Couldn't load all crypto prices (${e}).`) : [] };
}
