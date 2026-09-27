import type { ChainAdapter, ChainBalance, FetchContext } from "../types";

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

const TIMEOUT_MS = 15_000;
/** Multicall3, deployed at the same address on every chain we support. */
export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const BALANCE_OF = "70a08231";
const AGGREGATE3 = "82ad56cb";

const word = (hex: string) => hex.padStart(64, "0");
const wordN = (n: number | bigint) => word(n.toString(16));
const strip0x = (hex: string) => (hex.startsWith("0x") ? hex.slice(2) : hex);

export function normalizeEvmAddress(input: string): string | null {
  const s = input.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null;
}

/** Calldata for ERC-20 `balanceOf(owner)`. */
export function encodeBalanceOf(owner: string): string {
  return "0x" + BALANCE_OF + word(strip0x(owner).toLowerCase());
}

/** Calldata for Multicall3 `aggregate3((address,bool,bytes)[])` with allowFailure = true. */
export function encodeAggregate3(calls: { target: string; callData: string }[]): string {
  const tuples = calls.map(({ target, callData }) => {
    const data = strip0x(callData);
    const padded = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
    // target, allowFailure, offset of bytes within the tuple (3 head words), bytes length, bytes
    return word(strip0x(target).toLowerCase()) + wordN(1) + wordN(0x60) + wordN(data.length / 2) + padded;
  });
  let offset = calls.length * 32;
  const offsets = tuples.map((t) => {
    const o = wordN(offset);
    offset += t.length / 2;
    return o;
  });
  return "0x" + AGGREGATE3 + wordN(0x20) + wordN(calls.length) + offsets.join("") + tuples.join("");
}

/** Decodes the `(bool success, bytes returnData)[]` returned by aggregate3. */
export function decodeAggregate3(result: string): { success: boolean; returnData: string }[] {
  const hex = strip0x(result);
  const readWord = (byteOffset: number) => {
    const w = hex.slice(byteOffset * 2, byteOffset * 2 + 64);
    if (w.length !== 64) throw new Error("Malformed multicall response");
    return BigInt("0x" + w);
  };
  const arrayStart = Number(readWord(0));
  const length = Number(readWord(arrayStart));
  const elems = arrayStart + 32;
  return Array.from({ length }, (_, i) => {
    const tuple = elems + Number(readWord(elems + i * 32));
    const success = readWord(tuple) !== 0n;
    const bytesAt = tuple + Number(readWord(tuple + 32));
    const len = Number(readWord(bytesAt));
    const data = hex.slice((bytesAt + 32) * 2, (bytesAt + 32 + len) * 2);
    if (data.length !== len * 2) throw new Error("Malformed multicall response");
    return { success, returnData: "0x" + data };
  });
}

/** Parses a uint256 return value; empty return data (no contract code) counts as zero. */
export function decodeUint(hex: string): bigint {
  const h = strip0x(hex);
  return h.length === 0 ? 0n : BigInt("0x" + h.slice(0, 64));
}

/** Converts base units to a human number without float loss before the final step. */
export function formatUnits(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0");
  return Number(decimals > 0 ? `${whole}.${frac}` : `${whole}`);
}

type RpcRequest = { method: string; params: unknown[] };
type RpcResponse = { id?: unknown; result?: unknown; error?: { message?: string } };

class RpcError extends Error {
  /** True when the server answered, so retrying the same endpoint differently may help. */
  readonly responded: boolean;
  constructor(message: string, responded: boolean) {
    super(message);
    this.responded = responded;
  }
}

async function postJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new RpcError(e instanceof Error ? e.message : String(e), false);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`, true);
  try {
    return await res.json();
  } catch {
    throw new RpcError("Invalid JSON response", true);
  }
}

function unwrap(response: RpcResponse | undefined): string {
  if (!response) throw new RpcError("Missing response", true);
  if (response.error) throw new RpcError(response.error.message ?? "JSON-RPC error", true);
  if (typeof response.result !== "string") throw new RpcError("Unexpected result", true);
  return response.result;
}

/**
 * Sends the requests as one JSON-RPC batch; if the endpoint rejects or caps
 * batches (drpc's free tier allows 3, mainnet.base.org 10), resends them one by one.
 */
async function rpcAll(url: string, requests: RpcRequest[], fetchImpl: typeof fetch): Promise<string[]> {
  const body = requests.map((r, i) => ({ jsonrpc: "2.0", id: i + 1, ...r }));
  if (requests.length > 1) {
    try {
      const res = await postJson(url, body, fetchImpl);
      if (Array.isArray(res)) {
        const byId = new Map((res as RpcResponse[]).map((r) => [r?.id, r]));
        return body.map((b) => unwrap(byId.get(b.id)));
      }
    } catch (e) {
      if (e instanceof RpcError && !e.responded) throw e;
    }
  }
  const results: string[] = [];
  for (const b of body) results.push(unwrap((await postJson(url, b, fetchImpl)) as RpcResponse));
  return results;
}

async function fetchFromEndpoint(config: EvmChainConfig, owner: string, url: string, fetchImpl: typeof fetch) {
  const requests: RpcRequest[] = [{ method: "eth_getBalance", params: [owner, "latest"] }];
  if (config.tokens.length > 0) {
    const data = encodeAggregate3(config.tokens.map((t) => ({ target: t.address, callData: encodeBalanceOf(owner) })));
    requests.push({ method: "eth_call", params: [{ to: MULTICALL3, data }, "latest"] });
  }
  const [nativeHex, multicallHex] = await rpcAll(url, requests, fetchImpl);

  const balances: ChainBalance[] = [];
  const wei = BigInt(nativeHex);
  if (wei > 0n) {
    balances.push({
      symbol: config.nativeSymbol,
      name: config.nativeName,
      amount: formatUnits(wei, 18),
      contract: null,
      coingeckoId: config.nativeCoingeckoId,
    });
  }
  if (multicallHex !== undefined) {
    let results: ReturnType<typeof decodeAggregate3>;
    try {
      results = decodeAggregate3(multicallHex);
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), true);
    }
    if (results.length !== config.tokens.length) throw new RpcError("Multicall result count mismatch", true);
    config.tokens.forEach((token, i) => {
      const { success, returnData } = results[i];
      if (!success) return;
      const raw = decodeUint(returnData);
      if (raw === 0n) return;
      balances.push({
        symbol: token.symbol,
        name: token.name,
        amount: formatUnits(raw, token.decimals),
        contract: token.address.toLowerCase(),
        coingeckoId: token.coingeckoId,
      });
    });
  }
  return balances;
}

export function createEvmChain(config: EvmChainConfig): ChainAdapter {
  return {
    id: config.id,
    label: config.label,
    family: "evm",
    defaultRpcUrls: config.defaultRpcUrls,
    coingeckoPlatform: config.coingeckoPlatform,
    normalizeAddress: normalizeEvmAddress,
    fetchBalances: async (address: string, ctx: FetchContext) => {
      const owner = normalizeEvmAddress(address);
      if (!owner) throw new Error(`Invalid ${config.label} address`);
      for (const url of ctx.rpcUrls) {
        try {
          return await fetchFromEndpoint(config, owner, url, ctx.fetch);
        } catch {
          // Try the next endpoint.
        }
      }
      throw new Error(`Couldn't reach ${config.label} RPC endpoints`);
    },
    explorerUrl: (address) => `${config.explorer}/address/${address}`,
  };
}

// Token addresses and decimals were checked on-chain (symbol()/decimals()) and
// against CoinGecko. Canonical-bridge copies (e.g. WETH on L2s) use the
// canonical asset's CoinGecko id, which has the deepest price data.

export const ethereum = createEvmChain({
  id: "ethereum",
  label: "Ethereum",
  chainId: 1,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "ethereum",
  defaultRpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.mevblocker.io"],
  explorer: "https://etherscan.io",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, coingeckoId: "usd-coin" },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, coingeckoId: "tether" },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, coingeckoId: "dai" },
    { symbol: "USDS", name: "USDS Stablecoin", address: "0xdC035D45d973E3EC169d2276DDab16f1e407384F", decimals: 18, coingeckoId: "usds" },
    { symbol: "PYUSD", name: "PayPal USD", address: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", decimals: 6, coingeckoId: "paypal-usd" },
    { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, coingeckoId: "weth" },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, coingeckoId: "wrapped-bitcoin" },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
    { symbol: "stETH", name: "Lido Staked Ether", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, coingeckoId: "staked-ether" },
    { symbol: "wstETH", name: "Wrapped stETH", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", decimals: 18, coingeckoId: "wrapped-steth" },
    { symbol: "rETH", name: "Rocket Pool ETH", address: "0xae78736Cd615f374D3085123A210448E74Fc6393", decimals: 18, coingeckoId: "rocket-pool-eth" },
    { symbol: "weETH", name: "Wrapped eETH", address: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", decimals: 18, coingeckoId: "wrapped-eeth" },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, coingeckoId: "chainlink" },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, coingeckoId: "uniswap" },
    { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, coingeckoId: "aave" },
    { symbol: "SHIB", name: "Shiba Inu", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18, coingeckoId: "shiba-inu" },
    { symbol: "PEPE", name: "Pepe", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18, coingeckoId: "pepe" },
  ],
});

export const base = createEvmChain({
  id: "base",
  label: "Base",
  chainId: 8453,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "base",
  defaultRpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  explorer: "https://basescan.org",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, coingeckoId: "usd-coin" },
    { symbol: "USDbC", name: "USD Base Coin (bridged)", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6, coingeckoId: "bridged-usd-coin-base" },
    { symbol: "USDT", name: "Tether USD (bridged)", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, coingeckoId: "tether" },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, coingeckoId: "dai" },
    { symbol: "EURC", name: "Euro Coin", address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", decimals: 6, coingeckoId: "euro-coin" },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, coingeckoId: "weth" },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
    { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, coingeckoId: "coinbase-wrapped-staked-eth" },
    { symbol: "wstETH", name: "Wrapped stETH", address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18, coingeckoId: "wrapped-steth" },
    { symbol: "weETH", name: "Wrapped eETH", address: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A", decimals: 18, coingeckoId: "wrapped-eeth" },
    { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18, coingeckoId: "aerodrome-finance" },
    { symbol: "VIRTUAL", name: "Virtuals Protocol", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", decimals: 18, coingeckoId: "virtual-protocol" },
    { symbol: "DEGEN", name: "Degen", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18, coingeckoId: "degen-base" },
    { symbol: "BRETT", name: "Brett", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18, coingeckoId: "based-brett" },
  ],
});

export const arbitrum = createEvmChain({
  id: "arbitrum",
  label: "Arbitrum",
  chainId: 42161,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "arbitrum-one",
  defaultRpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"],
  explorer: "https://arbiscan.io",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, coingeckoId: "usd-coin" },
    { symbol: "USDC.e", name: "USD Coin (bridged)", address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6, coingeckoId: "usd-coin-ethereum-bridged" },
    // Tether's USDT0 (OFT) replaced the bridged USDT at this address.
    { symbol: "USDT", name: "Tether USD (USDT0)", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, coingeckoId: "tether" },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, coingeckoId: "dai" },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, coingeckoId: "weth" },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, coingeckoId: "wrapped-bitcoin" },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, coingeckoId: "coinbase-wrapped-btc" },
    { symbol: "wstETH", name: "Wrapped stETH", address: "0x5979D7b546E38E414F7E9822514be443A4800529", decimals: 18, coingeckoId: "wrapped-steth" },
    { symbol: "weETH", name: "Wrapped eETH", address: "0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe", decimals: 18, coingeckoId: "wrapped-eeth" },
    { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, coingeckoId: "arbitrum" },
    { symbol: "GMX", name: "GMX", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18, coingeckoId: "gmx" },
    { symbol: "PENDLE", name: "Pendle", address: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", decimals: 18, coingeckoId: "pendle" },
    { symbol: "LINK", name: "Chainlink", address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, coingeckoId: "chainlink" },
    { symbol: "UNI", name: "Uniswap", address: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", decimals: 18, coingeckoId: "uniswap" },
  ],
});
