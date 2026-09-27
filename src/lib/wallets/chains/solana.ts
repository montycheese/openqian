import type { ChainAdapter, ChainBalance, FetchContext } from "../types";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes a base58 string to bytes, or null if it contains invalid characters. */
export function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = []; // little-endian
  for (const char of input) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" encodes a leading zero byte.
  for (let i = 0; i < input.length && input[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type KnownToken = { symbol: string; name: string; coingeckoId: string };

// Mint -> metadata. Verified against CoinGecko's platform data (coins/list with
// platforms), matching mint -> id in both directions.
const KNOWN_TOKENS: Record<string, KnownToken> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether", coingeckoId: "tether" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", name: "PayPal USD", coingeckoId: "paypal-usd" },
  So11111111111111111111111111111111111111112: { symbol: "wSOL", name: "Wrapped SOL", coingeckoId: "wrapped-solana" },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter", coingeckoId: "jupiter-exchange-solana" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", name: "Bonk", coingeckoId: "bonk" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF", name: "dogwifhat", coingeckoId: "dogwifcoin" },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: "PYTH", name: "Pyth Network", coingeckoId: "pyth-network" },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: "JTO", name: "Jito", coingeckoId: "jito-governance-token" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", name: "Raydium", coingeckoId: "raydium" },
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: { symbol: "ORCA", name: "Orca", coingeckoId: "orca" },
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": { symbol: "W", name: "Wormhole", coingeckoId: "wormhole" },
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: { symbol: "RENDER", name: "Render", coingeckoId: "render-token" },
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": { symbol: "POPCAT", name: "Popcat", coingeckoId: "popcat" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", name: "Marinade Staked SOL", coingeckoId: "msol" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "jitoSOL", name: "Jito Staked SOL", coingeckoId: "jito-staked-sol" },
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: { symbol: "bSOL", name: "BlazeStake Staked SOL", coingeckoId: "blazestake-staked-sol" },
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v: { symbol: "JupSOL", name: "Jupiter Staked SOL", coingeckoId: "jupiter-staked-sol" },
};

const TIMEOUT_MS = 15_000;

/** Exact sum of decimal strings like "1.5" + "0.25", kept as BigInt with a shared scale. */
class DecimalSum {
  private units = BigInt(0);
  private scale = 0;

  add(value: string) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return;
    const frac = match[2] ?? "";
    if (frac.length > this.scale) {
      this.units *= BigInt(10) ** BigInt(frac.length - this.scale);
      this.scale = frac.length;
    }
    this.units += BigInt(match[1] + frac.padEnd(this.scale, "0"));
  }

  toNumber(): number {
    const digits = this.units.toString().padStart(this.scale + 1, "0");
    const cut = digits.length - this.scale;
    return Number(this.scale ? `${digits.slice(0, cut)}.${digits.slice(cut)}` : digits);
  }
}

type TokenAccount = {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmountString: string } } } } };
};

async function rpc<T>(ctx: FetchContext, url: string, method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  const res = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? "empty RPC result");
  return body.result;
}

async function fetchFrom(url: string, owner: string, ctx: FetchContext): Promise<ChainBalance[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const tokenAccounts = (programId: string) =>
      rpc<{ value: TokenAccount[] }>(ctx, url, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }], controller.signal);
    // All three must succeed on the same endpoint: silently dropping tokens would
    // look like a sudden drop in net worth.
    const [lamports, classic, token2022] = await Promise.all([
      rpc<{ value: number }>(ctx, url, "getBalance", [owner], controller.signal),
      tokenAccounts(TOKEN_PROGRAM),
      tokenAccounts(TOKEN_2022_PROGRAM),
    ]);

    const balances: ChainBalance[] = [];
    if (lamports.value > 0) {
      balances.push({ symbol: "SOL", name: "Solana", amount: lamports.value / 1e9, contract: null, coingeckoId: "solana" });
    }

    const byMint = new Map<string, DecimalSum>();
    for (const { account } of [...classic.value, ...token2022.value]) {
      const { mint, tokenAmount } = account.data.parsed.info;
      let sum = byMint.get(mint);
      if (!sum) byMint.set(mint, (sum = new DecimalSum()));
      sum.add(tokenAmount.uiAmountString);
    }
    for (const [mint, sum] of byMint) {
      const amount = sum.toNumber();
      if (amount <= 0) continue;
      const known = KNOWN_TOKENS[mint];
      balances.push({
        symbol: known?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`,
        name: known?.name ?? "Unknown token",
        amount,
        contract: mint,
        coingeckoId: known?.coingeckoId ?? null,
      });
    }
    return balances;
  } finally {
    clearTimeout(timer);
  }
}

// Native SOL in stake accounts isn't included yet (would need getProgramAccounts
// on the Stake program, which public RPCs usually block).
export const solana: ChainAdapter = {
  id: "solana",
  label: "Solana",
  family: "solana",
  // The official endpoint is the only free keyless RPC found that serves
  // getTokenAccountsByOwner (publicnode, Tatum, dRPC, Ankr etc. block or paywall
  // it), so there's no default fallback; users can add their own RPC URL.
  defaultRpcUrls: ["https://api.mainnet-beta.solana.com"],
  coingeckoPlatform: "solana",
  normalizeAddress(input) {
    const address = input.trim();
    return base58Decode(address)?.length === 32 ? address : null;
  },
  async fetchBalances(address, ctx) {
    for (const url of ctx.rpcUrls) {
      try {
        return await fetchFrom(url, address, ctx);
      } catch {
        // Try the next endpoint.
      }
    }
    throw new Error("Couldn't reach Solana RPC endpoints");
  },
  explorerUrl: (address) => `https://solscan.io/account/${address}`,
};
