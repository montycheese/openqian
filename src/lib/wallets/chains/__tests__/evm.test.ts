import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MULTICALL3,
  arbitrum,
  base,
  createEvmChain,
  decodeAggregate3,
  decodeUint,
  encodeAggregate3,
  encodeBalanceOf,
  ethereum,
  formatUnits,
} from "@/lib/wallets/chains/evm";

const OWNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const owner = OWNER.toLowerCase();
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
// tsconfig targets ES2017, which has no bigint literals.
const ONE_ETH = BigInt(10) ** BigInt(18);

const chain = createEvmChain({
  id: "base",
  label: "Base",
  chainId: 8453,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  nativeCoingeckoId: "ethereum",
  coingeckoPlatform: "base",
  defaultRpcUrls: [],
  explorer: "https://basescan.org",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: USDC, decimals: 6, coingeckoId: "usd-coin" },
    { symbol: "WETH", name: "Wrapped Ether", address: WETH, decimals: 18, coingeckoId: "weth" },
    { symbol: "AERO", name: "Aerodrome", address: AERO, decimals: 18, coingeckoId: "aerodrome-finance" },
  ],
});

const w = (n: bigint | number) => n.toString(16).padStart(64, "0");

/** ABI-encodes aggregate3's `(bool, bytes)[]` return value. */
function encodeResults(results: { success: boolean; data: string }[]): string {
  const tuples = results.map(({ success, data }) => {
    const hex = data.replace(/^0x/, "");
    return w(success ? 1 : 0) + w(0x40) + w(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  });
  let offset = results.length * 32;
  const offsets = tuples.map((t) => {
    const o = w(offset);
    offset += t.length / 2;
    return o;
  });
  return "0x" + w(0x20) + w(results.length) + offsets.join("") + tuples.join("");
}

type Rpc = { id: number; method: string; params: [unknown, unknown] };

/** A fake JSON-RPC node answering eth_getBalance and the aggregate3 eth_call. */
function fakeNode(
  wei: bigint,
  tokenBalances: Record<string, bigint>,
  opts: { rejectBatch?: boolean } = {},
) {
  const answer = (req: Rpc) => {
    if (req.method === "eth_getBalance") {
      expect(req.params).toEqual([owner, "latest"]);
      return { jsonrpc: "2.0", id: req.id, result: "0x" + wei.toString(16) };
    }
    const { to, data } = req.params[0] as { to: string; data: string };
    expect(to).toBe(MULTICALL3);
    expect(data.slice(0, 10)).toBe("0x82ad56cb");
    const calls = decodeCalls(data);
    const results = calls.map(({ target, callData }) => {
      expect(callData).toBe(encodeBalanceOf(owner));
      const bal = tokenBalances[target];
      if (bal === undefined) return { success: false, data: "" };
      return { success: true, data: w(bal) };
    });
    return { jsonrpc: "2.0", id: req.id, result: encodeResults(results) };
  };
  return (body: unknown) => {
    if (Array.isArray(body)) {
      if (opts.rejectBatch) return { jsonrpc: "2.0", id: null, error: { code: -32014, message: "maximum 1 calls in 1 batch" } };
      // Real nodes may answer out of order.
      return (body as Rpc[]).map(answer).reverse();
    }
    return answer(body as Rpc);
  };
}

/** Minimal decoder for aggregate3 calldata, to check what we sent. */
function decodeCalls(data: string): { target: string; callData: string }[] {
  const hex = data.slice(10);
  const at = (byte: number) => Number(BigInt("0x" + hex.slice(byte * 2, byte * 2 + 64)));
  const arr = at(0);
  const n = at(arr);
  return Array.from({ length: n }, (_, i) => {
    const t = arr + 32 + at(arr + 32 + i * 32);
    const target = "0x" + hex.slice(t * 2 + 24, t * 2 + 64);
    expect(at(t + 32)).toBe(1); // allowFailure
    const b = t + at(t + 64);
    const len = at(b);
    return { target, callData: "0x" + hex.slice((b + 32) * 2, (b + 32 + len) * 2) };
  });
}

type Handler = (body: unknown, url: string) => unknown;

function fakeFetch(handlers: Record<string, Handler | "network" | number>) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    const h = handlers[url];
    if (h === undefined || h === "network") throw new TypeError("fetch failed");
    if (typeof h === "number") return new Response("<html>down</html>", { status: h });
    return Response.json(h(body, url));
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeAddress", () => {
  it("accepts any case and returns lowercase", () => {
    expect(chain.normalizeAddress(OWNER)).toBe(owner);
    expect(chain.normalizeAddress(`  ${OWNER.toUpperCase().replace("0X", "0x")} `)).toBe(owner);
  });

  it("rejects malformed input", () => {
    expect(chain.normalizeAddress("0x1234")).toBeNull();
    expect(chain.normalizeAddress(owner.slice(2))).toBeNull();
    expect(chain.normalizeAddress(owner + "0")).toBeNull();
    expect(chain.normalizeAddress("0xzz" + owner.slice(4))).toBeNull();
    expect(chain.normalizeAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBeNull();
  });
});

describe("formatUnits", () => {
  it("converts wei and token units without precision loss", () => {
    expect(formatUnits(BigInt("1500000000000000000"), 18)).toBe(1.5);
    expect(formatUnits(BigInt("1234567"), 6)).toBe(1.234567);
    expect(formatUnits(BigInt("1"), 18)).toBe(1e-18);
    expect(formatUnits(BigInt("1"), 6)).toBe(0.000001);
    expect(formatUnits(BigInt("588367514"), 8)).toBe(5.88367514);
    expect(formatUnits(BigInt("0"), 18)).toBe(0);
    expect(formatUnits(BigInt("42"), 0)).toBe(42);
  });

  it("stays exact for amounts far beyond 2^53 base units", () => {
    // 123,456,789.123456789 tokens with 18 decimals: ~1.2e26 wei.
    expect(formatUnits(BigInt("123456789123456789000000000"), 18)).toBe(123456789.123456789);
    expect(formatUnits(BigInt("10") ** BigInt("30") + BigInt("1"), 18)).toBe(1_000_000_000_000);
  });
});

describe("ABI encoding", () => {
  it("encodes balanceOf(owner)", () => {
    expect(encodeBalanceOf(OWNER)).toBe("0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("encodes aggregate3 with allowFailure and padded calldata", () => {
    const callData = encodeBalanceOf(OWNER);
    expect(encodeAggregate3([{ target: USDC, callData }])).toBe(
      "0x82ad56cb" +
        w(0x20) + // offset of the array
        w(1) + // length
        w(0x20) + // offset of tuple 0 (after the one offset word)
        w(BigInt(USDC)) + // target
        w(1) + // allowFailure
        w(0x60) + // offset of bytes within the tuple
        w(36) + // bytes length
        callData.slice(2).padEnd(128, "0"),
    );
  });

  it("round-trips several calls", () => {
    const calls = [USDC, WETH, AERO].map((t) => ({ target: t, callData: encodeBalanceOf(OWNER) }));
    expect(decodeCalls(encodeAggregate3(calls))).toEqual(calls.map((c) => ({ ...c, target: c.target.toLowerCase() })));
  });

  it("decodes aggregate3 results, including failures and empty return data", () => {
    const encoded = encodeResults([
      { success: true, data: w(BigInt("1000000")) },
      { success: false, data: "08c379a0" + w(0x20) + w(4) + "64656164".padEnd(64, "0") },
      { success: true, data: "" },
    ]);
    const decoded = decodeAggregate3(encoded);
    expect(decoded).toHaveLength(3);
    expect(decoded[0]).toEqual({ success: true, returnData: "0x" + w(BigInt("1000000")) });
    expect(decoded[1].success).toBe(false);
    expect(decoded[2]).toEqual({ success: true, returnData: "0x" });
    expect(decodeUint(decoded[0].returnData)).toBe(BigInt("1000000"));
    expect(decodeUint(decoded[2].returnData)).toBe(BigInt("0"));
  });

  it("rejects truncated results", () => {
    const encoded = encodeResults([{ success: true, data: w(BigInt("1")) }]);
    expect(() => decodeAggregate3(encoded.slice(0, -64))).toThrow(/Malformed/);
  });
});

describe("fetchBalances", () => {
  it("returns native and non-zero token balances", async () => {
    const node = fakeNode(BigInt("1500000000000000000"), {
      [USDC.toLowerCase()]: BigInt("12345678"),
      [WETH.toLowerCase()]: BigInt("0"),
      [AERO.toLowerCase()]: BigInt("1"),
    });
    const { fetch, calls } = fakeFetch({ "https://a": node });
    const balances = await chain.fetchBalances(OWNER, { rpcUrls: ["https://a"], fetch });
    expect(balances).toEqual([
      { symbol: "ETH", name: "Ether", amount: 1.5, contract: null, coingeckoId: "ethereum" },
      { symbol: "USDC", name: "USD Coin", amount: 12.345678, contract: USDC.toLowerCase(), coingeckoId: "usd-coin" },
      { symbol: "AERO", name: "Aerodrome", amount: 1e-18, contract: AERO.toLowerCase(), coingeckoId: "aerodrome-finance" },
    ]);
    // One HTTP request: a two-item batch of eth_getBalance + one multicall eth_call.
    expect(calls).toHaveLength(1);
    expect(Array.isArray(calls[0].body)).toBe(true);
    expect((calls[0].body as Rpc[]).map((r) => r.method)).toEqual(["eth_getBalance", "eth_call"]);
  });

  it("omits zero native balance and failed token calls", async () => {
    const node = fakeNode(BigInt("0"), { [WETH.toLowerCase()]: BigInt("2") * ONE_ETH });
    const { fetch } = fakeFetch({ "https://a": node });
    const balances = await chain.fetchBalances(OWNER, { rpcUrls: ["https://a"], fetch });
    expect(balances.map((b) => [b.symbol, b.amount])).toEqual([["WETH", 2]]);
  });

  it("returns nothing for an empty wallet", async () => {
    const { fetch } = fakeFetch({ "https://a": fakeNode(BigInt("0"), {}) });
    expect(await chain.fetchBalances(OWNER, { rpcUrls: ["https://a"], fetch })).toEqual([]);
  });

  it("falls back to the next URL on network, HTTP and JSON-RPC errors", async () => {
    const node = fakeNode(ONE_ETH, {});
    const rpcError = () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Unauthorized" } });
    for (const failing of ["network", 525, rpcError] as const) {
      const { fetch, calls } = fakeFetch({ "https://a": failing, "https://b": node });
      const balances = await chain.fetchBalances(OWNER, { rpcUrls: ["https://a", "https://b"], fetch });
      expect(balances.map((b) => b.symbol)).toEqual(["ETH"]);
      expect(calls.at(-1)?.url).toBe("https://b");
    }
  });

  it("falls back to single requests when an endpoint rejects batches", async () => {
    const node = fakeNode(ONE_ETH, { [USDC.toLowerCase()]: BigInt("5000000") }, { rejectBatch: true });
    const { fetch, calls } = fakeFetch({ "https://a": node, "https://b": () => { throw new Error("unused"); } });
    const balances = await chain.fetchBalances(OWNER, { rpcUrls: ["https://a", "https://b"], fetch });
    expect(balances.map((b) => [b.symbol, b.amount])).toEqual([["ETH", 1], ["USDC", 5]]);
    expect(calls.map((c) => [c.url, Array.isArray(c.body)])).toEqual([
      ["https://a", true],
      ["https://a", false],
      ["https://a", false],
    ]);
  });

  it("does not retry a timed-out endpoint and moves on after 15s", async () => {
    vi.useFakeTimers();
    const node = fakeNode(ONE_ETH, {});
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "https://slow") {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Response.json(node(JSON.parse(String(init?.body))));
    });
    const pending = chain.fetchBalances(OWNER, { rpcUrls: ["https://slow", "https://ok"], fetch: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).map((b) => b.symbol)).toEqual(["ETH"]);
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual(["https://slow", "https://ok"]);
  });

  it("throws a readable error naming the chain when every endpoint fails", async () => {
    const { fetch } = fakeFetch({ "https://a": "network", "https://b": 503 });
    await expect(chain.fetchBalances(OWNER, { rpcUrls: ["https://a", "https://b"], fetch })).rejects.toThrow(
      "Couldn't reach Base RPC endpoints",
    );
  });

  it("rejects invalid addresses without touching the network", async () => {
    const { fetch, calls } = fakeFetch({});
    await expect(chain.fetchBalances("0x123", { rpcUrls: ["https://a"], fetch })).rejects.toThrow(/Invalid/);
    expect(calls).toHaveLength(0);
  });
});

describe("chain configs", () => {
  it.each([ethereum, base, arbitrum])("$label has at least two default RPC URLs", (c) => {
    expect(c.defaultRpcUrls.length).toBeGreaterThanOrEqual(2);
    expect(c.family).toBe("evm");
  });
});
