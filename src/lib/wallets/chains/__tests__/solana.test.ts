import { describe, expect, it, vi } from "vitest";
import { solana } from "@/lib/wallets/chains/solana";

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const UNKNOWN = "12LHPdskkDHWR6veS3WrzATfABN9uettfTWvXpbsrise";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const tokenAccount = (mint: string, uiAmountString: string) => ({
  pubkey: "x",
  account: { data: { program: "spl-token", parsed: { info: { mint, tokenAmount: { uiAmountString } } } } },
});

type Rpc = { method: string; params: unknown[] };
type Handler = (req: Rpc, url: string) => unknown;

/** Fake fetch that answers JSON-RPC calls with handler(req) as the result. */
function fakeFetch(handler: Handler) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as Rpc;
    const result = handler(req, String(url));
    if (result instanceof Response) return result;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const wallet = (lamports: number, classic: object[], t22: object[]): Handler => (req) => {
  if (req.method === "getBalance") return { value: lamports };
  const programId = (req.params[1] as { programId: string }).programId;
  return { value: programId === TOKEN_PROGRAM ? classic : programId === TOKEN_2022 ? t22 : [] };
};

describe("solana.normalizeAddress", () => {
  it("accepts 32-byte base58 addresses, trimmed", () => {
    expect(solana.normalizeAddress(`  ${OWNER} `)).toBe(OWNER);
    expect(solana.normalizeAddress(USDC)).toBe(USDC);
    expect(solana.normalizeAddress("11111111111111111111111111111111")).toBe("11111111111111111111111111111111");
  });

  it("rejects non-base58, wrong lengths and other chains' addresses", () => {
    expect(solana.normalizeAddress("")).toBeNull();
    expect(solana.normalizeAddress(OWNER.slice(0, -2))).toBeNull();
    expect(solana.normalizeAddress(`${OWNER}zz`)).toBeNull();
    expect(solana.normalizeAddress(OWNER.replace("W", "0"))).toBeNull(); // "0" isn't base58
    expect(solana.normalizeAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBeNull(); // BTC P2PKH (25 bytes)
    expect(solana.normalizeAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBeNull(); // BTC P2SH
    expect(solana.normalizeAddress("0x742d35cc6634c0532925a3b844bc454e4438f44e")).toBeNull();
  });
});

describe("solana.fetchBalances", () => {
  it("returns SOL and aggregates tokens per mint across accounts and both token programs", async () => {
    const fetch = fakeFetch(
      wallet(
        2_500_000_000,
        [tokenAccount(USDC, "100.5"), tokenAccount(USDC, "0.25"), tokenAccount(PYUSD, "1")],
        [tokenAccount(PYUSD, "2.000001")],
      ),
    );
    const balances = await solana.fetchBalances(OWNER, { rpcUrls: ["https://rpc.test"], fetch });

    expect(balances).toEqual([
      { symbol: "SOL", name: "Solana", amount: 2.5, contract: null, coingeckoId: "solana" },
      { symbol: "USDC", name: "USD Coin", amount: 100.75, contract: USDC, coingeckoId: "usd-coin" },
      { symbol: "PYUSD", name: "PayPal USD", amount: 3.000001, contract: PYUSD, coingeckoId: "paypal-usd" },
    ]);
    const calls = fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(calls.filter((c) => c.method === "getTokenAccountsByOwner").map((c) => c.params)).toEqual([
      [OWNER, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }],
      [OWNER, { programId: TOKEN_2022 }, { encoding: "jsonParsed" }],
    ]);
  });

  it("sums decimal strings exactly", async () => {
    const fetch = fakeFetch(wallet(0, [tokenAccount(USDC, "0.1"), tokenAccount(USDC, "0.2")], []));
    const [usdc] = await solana.fetchBalances(OWNER, { rpcUrls: ["https://rpc.test"], fetch });
    expect(usdc.amount).toBe(0.3);
  });

  it("labels unknown mints by abbreviated address without a CoinGecko id", async () => {
    const fetch = fakeFetch(wallet(0, [tokenAccount(UNKNOWN, "42")], []));
    expect(await solana.fetchBalances(OWNER, { rpcUrls: ["https://rpc.test"], fetch })).toEqual([
      { symbol: "12LH…rise", name: "Unknown token", amount: 42, contract: UNKNOWN, coingeckoId: null },
    ]);
  });

  it("omits zero SOL and empty token accounts", async () => {
    const fetch = fakeFetch(wallet(0, [tokenAccount(USDC, "0"), tokenAccount(UNKNOWN, "0.0")], []));
    expect(await solana.fetchBalances(OWNER, { rpcUrls: ["https://rpc.test"], fetch })).toEqual([]);
  });

  it("falls back to the next endpoint on HTTP, RPC and network errors", async () => {
    const ok = wallet(1_000_000_000, [], []);
    const fetch = fakeFetch((req, url) => {
      if (url === "https://http-error.test") return new Response("busy", { status: 429 });
      if (url === "https://rpc-error.test" && req.method === "getTokenAccountsByOwner")
        return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Request blocked" } });
      if (url === "https://down.test") throw new TypeError("fetch failed");
      return ok(req, url);
    });
    const balances = await solana.fetchBalances(OWNER, {
      rpcUrls: ["https://http-error.test", "https://rpc-error.test", "https://down.test", "https://good.test"],
      fetch,
    });
    expect(balances).toEqual([{ symbol: "SOL", name: "Solana", amount: 1, contract: null, coingeckoId: "solana" }]);
  });

  it("gives up on a hung endpoint after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      ) as unknown as typeof globalThis.fetch;
      const result = solana.fetchBalances(OWNER, { rpcUrls: ["https://slow.test"], fetch });
      const assertion = expect(result).rejects.toThrow("Couldn't reach Solana RPC endpoints");
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws a readable error when every endpoint fails", async () => {
    const fetch = fakeFetch(() => new Response("nope", { status: 503 }));
    await expect(solana.fetchBalances(OWNER, { rpcUrls: ["https://a.test", "https://b.test"], fetch })).rejects.toThrow(
      "Couldn't reach Solana RPC endpoints",
    );
  });
});
