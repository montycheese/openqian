import type { ChainAdapter } from "../types";

// Placeholder: implemented separately (address balance via Esplora-style APIs).
export const bitcoin: ChainAdapter = {
  id: "bitcoin",
  label: "Bitcoin",
  family: "bitcoin",
  defaultRpcUrls: ["https://mempool.space/api", "https://blockstream.info/api"],
  coingeckoPlatform: null,
  normalizeAddress: (input) => (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i.test(input.trim()) ? input.trim() : null),
  fetchBalances: async () => {
    throw new Error("Bitcoin balances are not implemented yet");
  },
  explorerUrl: (address) => `https://mempool.space/address/${address}`,
};
