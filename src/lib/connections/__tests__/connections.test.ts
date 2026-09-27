import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
import { toPositions } from "@/lib/connections/exchange";

process.env.OPENCHIENG_PASSPHRASE = "test-passphrase"; // keep tests out of the real keychain

let db: DB;
const fakeExchange = {
  permissions: { can_view: true, can_trade: false, can_transfer: false },
  totals: {} as Record<string, number>,
  fail: null as Error | null,
};
const created: { apiKey: string; secret: string }[] = [];

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/connections/exchange", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/connections/exchange")>();
  return {
    ...mod,
    createExchange: async (_id: string, creds: { apiKey: string; secret: string }) => {
      created.push(creds);
      return {};
    },
    excessPermissions: async () =>
      [fakeExchange.permissions.can_trade && "trade", fakeExchange.permissions.can_transfer && "transfer"].filter(Boolean),
    fetchPositions: async () => {
      if (fakeExchange.fail) throw fakeExchange.fail;
      return mod.toPositions(fakeExchange.totals, { BTC: 100_000, ETH: 4_000 });
    },
  };
});

const actions = await import("@/lib/connections/actions");
const { accounts, connections, holdings, secrets } = await import("@/lib/db/schema");
const { getSecret } = await import("@/lib/secrets");

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  db = openDatabase(":memory:");
  created.length = 0;
  fakeExchange.permissions = { can_view: true, can_trade: false, can_transfer: false };
  fakeExchange.totals = { BTC: 0.5, ETH: 2, USDC: 100, USD: 25, DOGE: 0 };
  fakeExchange.fail = null;
});

describe("toPositions", () => {
  it("prices crypto, treats fiat as cash and stablecoins at $1, skips zero balances", () => {
    const { positions, unpriced } = toPositions({ BTC: 0.5, USD: 25, USDC: 100, XYZ: 3, DOGE: 0 }, { BTC: 100_000 });
    expect(positions.map((p) => [p.symbol, p.type, p.marketValue])).toEqual([
      ["BTC", "crypto", 50_000],
      ["USDC", "crypto", 100],
      ["USD", "cash", 25],
      ["XYZ", "crypto", 0],
    ]);
    expect(unpriced).toEqual(["XYZ"]);
  });
});

describe("exchange connections", () => {
  it("connects, encrypts credentials, and imports balances", async () => {
    const res = await actions.addConnection(
      {},
      form({ exchange: "coinbase", name: "", apiKey: "organizations/x/apiKeys/y", secret: "-----BEGIN EC PRIVATE KEY-----\\nabc\\n-----END EC PRIVATE KEY-----" }),
    );
    expect(res).toEqual({ ok: true, message: undefined });
    const account = db.select().from(accounts).get()!;
    expect(account).toMatchObject({ name: "Coinbase", institution: "Coinbase", kind: "holdings", source: "connection" });
    expect(db.select().from(holdings).all().reduce((s, h) => s + h.marketValue, 0)).toBe(50_000 + 8_000 + 100 + 25);

    const conn = db.select().from(connections).get()!;
    const row = db.select().from(secrets).get()!;
    expect(row.ciphertext).not.toContain("organizations/x");
    expect(JSON.parse((await getSecret(db, `connection:${conn.id}`))!)).toMatchObject({ apiKey: "organizations/x/apiKeys/y" });
  });

  it("refuses keys that can trade or transfer", async () => {
    fakeExchange.permissions.can_trade = true;
    const res = await actions.addConnection({}, form({ exchange: "coinbase", name: "", apiKey: "k", secret: "s" }));
    expect(res.error).toMatch(/can trade/);
    expect(db.select().from(accounts).all()).toHaveLength(0);
  });

  it("refreshes with stored credentials and records failures", async () => {
    await actions.addConnection({}, form({ exchange: "coinbase", name: "Main", apiKey: "key-1", secret: "secret-1" }));
    const conn = db.select().from(connections).get()!;

    fakeExchange.totals = { BTC: 1 };
    expect(await actions.refreshConnection({}, form({ id: conn.id }))).toMatchObject({ ok: true });
    expect(created.at(-1)).toEqual({ apiKey: "key-1", secret: "secret-1" });
    expect(db.select().from(holdings).all().map((h) => [h.symbol, h.marketValue])).toEqual([["BTC", 100_000]]);

    fakeExchange.fail = new Error("boom");
    expect((await actions.refreshConnection({}, form({ id: conn.id }))).error).toBe("boom");
    expect(db.select().from(connections).get()).toMatchObject({ status: "error", lastError: "boom" });
    expect(db.select().from(holdings).all()).toHaveLength(1); // last good data is kept
  });

  it("removing a connection deletes its credentials but keeps the account", async () => {
    await actions.addConnection({}, form({ exchange: "kraken", name: "", apiKey: "k", secret: "s" }));
    const conn = db.select().from(connections).get()!;
    await actions.removeConnection({}, form({ id: conn.id }));
    expect(db.select().from(secrets).all()).toHaveLength(0);
    expect(db.select().from(accounts).get()).toMatchObject({ name: "Kraken", source: "manual" });
  });
});
