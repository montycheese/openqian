import { describe, expect, it, vi } from "vitest";
import { bitcoin } from "@/lib/wallets/chains/bitcoin";

const GENESIS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const TAPROOT = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";

describe("bitcoin.normalizeAddress", () => {
  it("accepts mainnet legacy, P2SH, SegWit and Taproot addresses", () => {
    expect(bitcoin.normalizeAddress(` ${GENESIS} `)).toBe(GENESIS);
    expect(bitcoin.normalizeAddress(P2SH)).toBe(P2SH);
    expect(bitcoin.normalizeAddress(P2WPKH)).toBe(P2WPKH);
    expect(bitcoin.normalizeAddress(P2WSH)).toBe(P2WSH);
    expect(bitcoin.normalizeAddress(TAPROOT)).toBe(TAPROOT);
  });

  it("lowercases uppercase bech32 but rejects mixed case", () => {
    expect(bitcoin.normalizeAddress(P2WPKH.toUpperCase())).toBe(P2WPKH);
    expect(bitcoin.normalizeAddress("bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBeNull();
  });

  it("rejects checksum typos", () => {
    expect(bitcoin.normalizeAddress("1A1zP1eP5QGefi2DMPTfTLSSLmv7DivfNa")).toBeNull();
    expect(bitcoin.normalizeAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLz")).toBeNull();
    expect(bitcoin.normalizeAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")).toBeNull();
    expect(bitcoin.normalizeAddress("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj1")).toBeNull();
  });

  it("enforces bech32 for witness v0 and bech32m for v1+", () => {
    // Same programs, encoded with the other checksum constant.
    expect(bitcoin.normalizeAddress("bc1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysn4v0345")).not.toBeNull();
    expect(bitcoin.normalizeAddress("bc1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnqslask")).toBeNull();
    expect(bitcoin.normalizeAddress("bc1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sg5tmnz")).not.toBeNull();
    expect(bitcoin.normalizeAddress("bc1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sagmhkq")).toBeNull();
  });

  it("rejects v0 programs that aren't 20 or 32 bytes", () => {
    expect(bitcoin.normalizeAddress("bc1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9cc7vgsh7")).toBeNull();
  });

  it("rejects testnet addresses", () => {
    expect(bitcoin.normalizeAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBeNull();
    expect(bitcoin.normalizeAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")).toBeNull();
    expect(bitcoin.normalizeAddress("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc")).toBeNull();
  });

  it("rejects other chains' addresses and junk", () => {
    expect(bitcoin.normalizeAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBeNull(); // Solana
    expect(bitcoin.normalizeAddress("0x742d35cc6634c0532925a3b844bc454e4438f44e")).toBeNull();
    expect(bitcoin.normalizeAddress("")).toBeNull();
    expect(bitcoin.normalizeAddress("bc1")).toBeNull();
  });
});

const stats = (funded: number, spent: number) => ({ funded_txo_count: 1, funded_txo_sum: funded, spent_txo_count: 0, spent_txo_sum: spent, tx_count: 1 });

describe("bitcoin.fetchBalances", () => {
  it("adds confirmed and mempool balances in BTC", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ address: GENESIS, chain_stats: stats(5_747_581_566, 0), mempool_stats: stats(11_375, 0) }),
    ) as unknown as typeof globalThis.fetch;
    const balances = await bitcoin.fetchBalances(GENESIS, { rpcUrls: ["https://esplora.test/api/"], fetch });
    expect(balances).toEqual([{ symbol: "BTC", name: "Bitcoin", amount: 57.47592941, contract: null, coingeckoId: "bitcoin" }]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`https://esplora.test/api/address/${GENESIS}`);
  });

  it("subtracts unconfirmed spends", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ chain_stats: stats(300_000_000, 100_000_000), mempool_stats: stats(0, 50_000_000) }),
    ) as unknown as typeof globalThis.fetch;
    const [btc] = await bitcoin.fetchBalances(P2WPKH, { rpcUrls: ["https://esplora.test"], fetch });
    expect(btc.amount).toBe(1.5);
  });

  it("returns nothing for an empty address", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ chain_stats: stats(1000, 1000), mempool_stats: stats(0, 0) }),
    ) as unknown as typeof globalThis.fetch;
    expect(await bitcoin.fetchBalances(P2WPKH, { rpcUrls: ["https://esplora.test"], fetch })).toEqual([]);
  });

  it("falls back to the next endpoint on HTTP, network and malformed responses", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://a.test")) return new Response("Too Many Requests", { status: 429 });
      if (url.startsWith("https://b.test")) throw new TypeError("fetch failed");
      if (url.startsWith("https://c.test")) return Response.json({ nope: true });
      return Response.json({ chain_stats: stats(100_000_000, 0), mempool_stats: stats(0, 0) });
    }) as unknown as typeof globalThis.fetch;
    const balances = await bitcoin.fetchBalances(P2WPKH, {
      rpcUrls: ["https://a.test", "https://b.test", "https://c.test", "https://d.test"],
      fetch,
    });
    expect(balances).toEqual([{ symbol: "BTC", name: "Bitcoin", amount: 1, contract: null, coingeckoId: "bitcoin" }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it("throws a readable error when every endpoint fails", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 502 })) as unknown as typeof globalThis.fetch;
    await expect(bitcoin.fetchBalances(P2WPKH, { rpcUrls: ["https://a.test", "https://b.test"], fetch })).rejects.toThrow(
      "Couldn't reach Bitcoin API endpoints",
    );
  });
});
