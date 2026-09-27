import type { ChainAdapter } from "../types";

// Placeholder: the EVM adapter (native balance + curated ERC-20 tokens over
// public JSON-RPC) is implemented separately. Configs below are final.

export type EvmToken = { symbol: string; name: string; address: string; decimals: number; coingeckoId: string | null };

export type EvmChainConfig = {
  id: string;
  label: string;
  chainId: number;
  nativeSymbol: string;
  nativeName: string;
  nativeCoingeckoId: string;
  coingeckoPlatform: string;
  defaultRpcUrls: string[];
  explorer: string;
  tokens: EvmToken[];
};

export function createEvmChain(config: EvmChainConfig): ChainAdapter {
  return {
    id: config.id,
    label: config.label,
    family: "evm",
    defaultRpcUrls: config.defaultRpcUrls,
    coingeckoPlatform: config.coingeckoPlatform,
    normalizeAddress: (input) => (/^0x[0-9a-fA-F]{40}$/.test(input.trim()) ? input.trim().toLowerCase() : null),
    fetchBalances: async () => {
      throw new Error("EVM balances are not implemented yet");
    },
    explorerUrl: (address) => `${config.explorer}/address/${address}`,
  };
}

export const ethereum = createEvmChain({
  id: "ethereum",
  label: "Ethereum",
  chainId: 1,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "ethereum",
  defaultRpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  explorer: "https://etherscan.io",
  tokens: [],
});

export const base = createEvmChain({
  id: "base",
  label: "Base",
  chainId: 8453,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "base",
  defaultRpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  explorer: "https://basescan.org",
  tokens: [],
});

export const arbitrum = createEvmChain({
  id: "arbitrum",
  label: "Arbitrum",
  chainId: 42161,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "arbitrum-one",
  defaultRpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  explorer: "https://arbiscan.io",
  tokens: [],
});
