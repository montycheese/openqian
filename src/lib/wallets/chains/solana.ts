import type { ChainAdapter } from "../types";

// Placeholder: implemented separately (SOL + SPL tokens over public JSON-RPC).
export const solana: ChainAdapter = {
  id: "solana",
  label: "Solana",
  family: "solana",
  defaultRpcUrls: ["https://api.mainnet-beta.solana.com"],
  coingeckoPlatform: "solana",
  normalizeAddress: (input) => (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.trim()) ? input.trim() : null),
  fetchBalances: async () => {
    throw new Error("Solana balances are not implemented yet");
  },
  explorerUrl: (address) => `https://solscan.io/account/${address}`,
};
