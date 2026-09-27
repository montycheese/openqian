import type { ChainFamily } from "@/lib/db/schema";

export type { ChainFamily };

/** An asset balance found at an address on one chain. */
export type ChainBalance = {
  symbol: string;
  name: string;
  /** Human units (already divided by 10^decimals). */
  amount: number;
  /** Token contract / mint address; null for the chain's native asset. */
  contract: string | null;
  /** CoinGecko coin id when known (native assets and curated tokens). */
  coingeckoId: string | null;
};

export type FetchContext = {
  /** RPC / API base URLs to try in order; the first that works is used. */
  rpcUrls: string[];
  fetch: typeof fetch;
};

/**
 * Everything the app needs to know about a chain. Add a chain by writing an
 * adapter (or, for EVM networks, a config entry) and registering it in
 * `chains/index.ts`.
 */
export interface ChainAdapter {
  /** Stable id stored in the database, e.g. "base". */
  id: string;
  label: string;
  family: ChainFamily;
  /** Public endpoints used when the user hasn't configured their own. */
  defaultRpcUrls: string[];
  /** CoinGecko asset platform id, for pricing tokens by contract address. */
  coingeckoPlatform: string | null;
  /** Canonical form of a valid address for this chain, or null if invalid. */
  normalizeAddress(input: string): string | null;
  fetchBalances(address: string, ctx: FetchContext): Promise<ChainBalance[]>;
  explorerUrl(address: string): string;
}
