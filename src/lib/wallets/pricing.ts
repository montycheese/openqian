import { z } from "zod";
import { USD_STABLECOINS } from "@/lib/connections/exchange";
import type { ChainBalance } from "./types";

const API = "https://api.coingecko.com/api/v3";
// CoinGecko's free tier prices one contract per request, so unknown tokens are
// looked up individually and capped to stay under its rate limit.
const MAX_CONTRACT_LOOKUPS = 8;

const usdPrices = z.record(z.string(), z.object({ usd: z.number().nonnegative().finite().optional() }));

export type PricedInput = { balance: ChainBalance; platform: string | null };

/** Stable key for a balance's price: CoinGecko id, else platform:contract. */
export const priceKey = ({ balance, platform }: PricedInput) =>
  balance.coingeckoId ?? (balance.contract && platform ? `${platform}:${balance.contract.toLowerCase()}` : null);

async function getJson(fetchImpl: typeof fetch, url: string) {
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error("CoinGecko rate limit reached; try again in a minute");
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  return usdPrices.parse(await res.json());
}

/**
 * USD prices keyed by `priceKey`. Stablecoins are pegged at $1; failures are
 * reported in `errors` rather than thrown so balances still update.
 */
export async function priceBalances(items: PricedInput[], fetchImpl: typeof fetch = fetch) {
  const prices = new Map<string, number>();
  const errors: string[] = [];

  const ids = new Set<string>();
  const contracts = new Map<string, { platform: string; contract: string }>();
  for (const item of items) {
    const key = priceKey(item);
    if (!key) continue;
    if (USD_STABLECOINS.has(item.balance.symbol.toUpperCase())) prices.set(key, 1);
    else if (item.balance.coingeckoId) ids.add(item.balance.coingeckoId);
    else contracts.set(key, { platform: item.platform!, contract: item.balance.contract!.toLowerCase() });
  }

  try {
    if (ids.size > 0) {
      const data = await getJson(fetchImpl, `${API}/simple/price?ids=${[...ids].join(",")}&vs_currencies=usd`);
      for (const id of ids) if (data[id]?.usd !== undefined) prices.set(id, data[id].usd!);
    }
    for (const [key, { platform, contract }] of [...contracts].slice(0, MAX_CONTRACT_LOOKUPS)) {
      const data = await getJson(fetchImpl, `${API}/simple/token_price/${platform}?contract_addresses=${contract}&vs_currencies=usd`);
      const usd = data[contract]?.usd;
      if (usd !== undefined) prices.set(key, usd);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return { prices, errors };
}
