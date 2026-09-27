import { z } from "zod";
import { USD_STABLECOINS } from "@/lib/connections/exchange";
import type { ChainBalance } from "./types";

const API = "https://api.coingecko.com/api/v3";

const usdPrices = z.record(z.string(), z.object({ usd: z.number().nonnegative().finite().optional() }));

/**
 * USD prices keyed by CoinGecko id, in one batched request. Only curated tokens
 * (which carry an id) are priced: wallets hold thousands of spam airdrops, and
 * CoinGecko's free tier allows a single contract lookup per request, so pricing
 * unknown tokens by contract would hit its rate limit on every refresh.
 * Stablecoins are pegged at $1. Failures are returned, not thrown.
 */
export async function priceBalances(balances: ChainBalance[], fetchImpl: typeof fetch = fetch) {
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
    errors.push(`Couldn't load crypto prices: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { prices, errors };
}
