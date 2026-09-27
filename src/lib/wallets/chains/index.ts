import type { ChainAdapter, ChainFamily } from "../types";
import { bitcoin } from "./bitcoin";
import { arbitrum, base, ethereum } from "./evm";
import { solana } from "./solana";

/** Every supported chain. Register new adapters here. */
export const CHAINS: ChainAdapter[] = [ethereum, base, arbitrum, solana, bitcoin];

export const chainById = (id: string) => CHAINS.find((c) => c.id === id);
export const chainsInFamily = (family: ChainFamily) => CHAINS.filter((c) => c.family === family);

/** Which family an address belongs to, trying each chain's validator. */
export function detectFamily(input: string): { family: ChainFamily; address: string } | null {
  for (const chain of CHAINS) {
    const address = chain.normalizeAddress(input);
    if (address) return { family: chain.family, address };
  }
  return null;
}
