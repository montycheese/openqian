import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import type { ChainAdapter, ChainBalance } from "@/lib/wallets/types";

let db: DB;
const chainBalances: Record<string, ChainBalance[] | Error> = {};
const seenRpcUrls: Record<string, string[]> = {};

function fakeChain(id: string, family: "evm" | "solana" | "bitcoin", pattern: RegExp): ChainAdapter {
  return {
    id,
    label: id[0].toUpperCase() + id.slice(1),
    family,
    defaultRpcUrls: [`https://${id}.example`],
    coingeckoPlatform: family === "bitcoin" ? null : id,
    normalizeAddress: (a) => (pattern.test(a.trim()) ? a.trim().toLowerCase() : null),
    fetchBalances: async (_address, ctx) => {
      seenRpcUrls[id] = ctx.rpcUrls;
      const result = chainBalances[id];
      if (result instanceof Error) throw result;
      return result ?? [];
    },
    explorerUrl: (a) => a,
  };
}

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/wallets/chains", () => {
  const chains = [
    fakeChain("ethereum", "evm", /^0x[0-9a-f]{40}$/i),
    fakeChain("base", "evm", /^0x[0-9a-f]{40}$/i),
    fakeChain("solana", "solana", /^sol[a-z0-9]{5}$/i),
  ];
  return {
    CHAINS: chains,
    chainById: (id: string) => chains.find((c) => c.id === id),
    chainsInFamily: (f: string) => chains.filter((c) => c.family === f),
    detectFamily: (input: string) => {
      for (const c of chains) {
        const address = c.normalizeAddress(input);
        if (address) return { family: c.family, address };
      }
      return null;
    },
  };
});

// CoinGecko stand-in: ethereum = $2,000, contract lookups know one token.
const priceFetch = vi.fn(async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("/simple/price")) return Response.json({ ethereum: { usd: 2000 }, solana: { usd: 150 } });
  return Response.json({});
}) as unknown as typeof fetch;
vi.stubGlobal("fetch", priceFetch);

const actions = await import("@/lib/wallets/actions");
const { refreshWallet } = await import("@/lib/wallets");
const { accounts, holdings, settings, snapshots, wallets } = await import("@/lib/db/schema");

const ADDRESS = "0x" + "ab".repeat(20);
const form = (values: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};
const eth = (amount: number): ChainBalance => ({ symbol: "ETH", name: "Ether", amount, contract: null, coingeckoId: "ethereum" });
const usdc = (amount: number): ChainBalance => ({ symbol: "USDC", name: "USD Coin", amount, contract: "0xusdc", coingeckoId: "usd-coin" });

beforeEach(() => {
  db = openDatabase(":memory:");
  for (const k of Object.keys(chainBalances)) delete chainBalances[k];
});

describe("addWallet", () => {
  it("tracks an EVM address on the chosen networks and prices its balances", async () => {
    chainBalances.ethereum = [eth(1.5), usdc(100)];
    chainBalances.base = [eth(0.5)];
    const res = await actions.addWallet({}, form({ address: ADDRESS.toUpperCase().replace("0X", "0x"), name: "", chains: ["ethereum", "base"] }));
    expect(res.ok).toBe(true);

    const account = db.select().from(accounts).get()!;
    expect(account).toMatchObject({ kind: "holdings", source: "connection", institution: "EVM wallet", accountMask: "abab" });
    expect(db.select().from(wallets).get()).toMatchObject({ family: "evm", address: ADDRESS, chains: '["ethereum","base"]' });
    const rows = db.select().from(holdings).all();
    expect(rows.map((h) => [h.name, h.marketValue]).sort()).toEqual([
      ["Ether · Base", 1000],
      ["Ether · Ethereum", 3000],
      ["USD Coin · Ethereum", 100],
    ]);
    expect(db.select().from(snapshots).all()).toHaveLength(1);
  });

  it("rejects unknown address formats, duplicates, and no networks", async () => {
    expect((await actions.addWallet({}, form({ address: "hello", name: "" }))).error).toMatch(/doesn't look like/);
    expect((await actions.addWallet({}, form({ address: ADDRESS, name: "" }))).error).toMatch(/at least one network/);
    await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    expect((await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }))).error).toMatch(/already/);
  });

  it("uses every chain of a single-chain family without asking", async () => {
    chainBalances.solana = [{ symbol: "SOL", name: "Solana", amount: 2, contract: null, coingeckoId: "solana" }];
    await actions.addWallet({}, form({ address: "sol12345", name: "Phantom" }));
    expect(db.select().from(accounts).get()).toMatchObject({ name: "Phantom", institution: "Solana wallet" });
    expect(db.select().from(holdings).get()).toMatchObject({ name: "Solana", marketValue: 300 });
  });

  it("keeps the wallet when the first read fails", async () => {
    chainBalances.base = new Error("Couldn't reach Base RPC endpoints");
    const res = await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    expect(res.message).toMatch(/couldn't be loaded yet/);
    expect(db.select().from(wallets).get()).toMatchObject({ status: "error" });
  });
});

describe("refreshWallet", () => {
  it("leaves holdings untouched if any chain fails", async () => {
    chainBalances.ethereum = [eth(1)];
    chainBalances.base = [eth(1)];
    await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: ["ethereum", "base"] }));
    const wallet = db.select().from(wallets).get()!;

    chainBalances.base = new Error("Couldn't reach Base RPC endpoints");
    chainBalances.ethereum = [eth(5)];
    expect((await refreshWallet(db, wallet.id)).ok).toBe(false);
    expect(db.select().from(holdings).all().map((h) => h.marketValue).sort()).toEqual([2000, 2000]);
    expect(db.select().from(wallets).get()).toMatchObject({ status: "error", lastError: "Couldn't reach Base RPC endpoints" });
  });

  it("ignores tokens outside the curated lists (spam airdrops) without extra price lookups", async () => {
    chainBalances.base = [
      { symbol: "SCAM", name: "Claim reward", amount: 1e6, contract: "0xspam", coingeckoId: null },
      eth(1),
    ];
    (priceFetch as unknown as ReturnType<typeof vi.fn>).mockClear();
    await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    expect(db.select().from(holdings).all().map((h) => [h.symbol, h.marketValue])).toEqual([["ETH", 2000]]);
    expect((priceFetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("keeps the last known price when prices can't be loaded", async () => {
    chainBalances.base = [eth(1)];
    const mock = priceFetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementationOnce(async () => new Response("", { status: 429 }));
    const first = await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    expect(first.message).toMatch(/rate limit/);
    expect(db.select().from(holdings).get()).toMatchObject({ quantity: 1, price: null, marketValue: 0 });

    const wallet = db.select().from(wallets).get()!;
    await refreshWallet(db, wallet.id); // prices available: ETH = $2,000
    chainBalances.base = [eth(2)];
    mock.mockImplementationOnce(async () => new Response("", { status: 429 }));
    const res = await refreshWallet(db, wallet.id);
    expect(res.message).toMatch(/rate limit/);
    expect(db.select().from(holdings).get()).toMatchObject({ quantity: 2, price: 2000, marketValue: 4000 });
  });

  it("tries user-configured RPC endpoints before the defaults", async () => {
    db.insert(settings).values({ key: "rpc:base", value: "https://my-node.example\nhttps://base.example" }).run();
    await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    expect(seenRpcUrls.base).toEqual(["https://my-node.example", "https://base.example"]);
  });
});

describe("removeWallet and RPC settings", () => {
  it("stops tracking but keeps the account", async () => {
    await actions.addWallet({}, form({ address: ADDRESS, name: "", chains: "base" }));
    await actions.removeWallet({}, form({ id: db.select().from(wallets).get()!.id }));
    expect(db.select().from(wallets).all()).toHaveLength(0);
    expect(db.select().from(accounts).get()).toMatchObject({ source: "manual" });
  });

  it("validates and clears custom RPC URLs", async () => {
    expect((await actions.saveRpcUrls({}, form({ chain: "base", urls: "not a url" }))).error).toMatch(/Not a URL/);
    expect((await actions.saveRpcUrls({}, form({ chain: "base", urls: "https://a.example\nhttps://b.example" }))).ok).toBe(true);
    expect(db.select().from(settings).all().find((s) => s.key === "rpc:base")?.value).toBe("https://a.example\nhttps://b.example");
    await actions.saveRpcUrls({}, form({ chain: "base", urls: "" }));
    expect(db.select().from(settings).all().find((s) => s.key === "rpc:base")).toBeUndefined();
  });
});
