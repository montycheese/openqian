import type { Exchange } from "ccxt";
import { describe, expect, it } from "vitest";
import { fetchPositions, reservedByOrders, totalsWithReserved } from "@/lib/connections/exchange";

const order = (o: { symbol: string; side: "buy" | "sell"; price?: number; amount: number; filled?: number }) => ({
  price: undefined,
  filled: 0,
  remaining: undefined,
  ...o,
});

describe("reservedByOrders", () => {
  it("reserves quote currency for buys and the base asset for sells", () => {
    expect(
      reservedByOrders([
        order({ symbol: "BTC/USDC", side: "buy", price: 60_000, amount: 0.01 }),
        order({ symbol: "ETH/USD", side: "sell", price: 5_000, amount: 2, filled: 0.5 }),
        order({ symbol: "SOL/USDC", side: "buy", price: 100, amount: 3 }),
        order({ symbol: "BTC/USD", side: "buy", amount: 1 }), // market order without a price: unknown reserve
      ]),
    ).toEqual({ USDC: 900, ETH: 1.5 });
  });
});

describe("totalsWithReserved", () => {
  it("adds funds held by open orders when the exchange reports no hold", () => {
    expect(totalsWithReserved({ free: { USDC: 400 }, used: { USDC: 0 }, total: { USDC: 400 } }, { USDC: 600 })).toEqual({
      USDC: 1000,
    });
  });

  it("doesn't double-count when the exchange already reports the hold", () => {
    expect(totalsWithReserved({ free: { USDC: 400 }, used: { USDC: 600 }, total: { USDC: 1000 } }, { USDC: 600 })).toEqual({
      USDC: 1000,
    });
  });

  it("counts a currency that is entirely reserved", () => {
    expect(totalsWithReserved({ free: {}, used: {}, total: {} }, { USDC: 600 })).toEqual({ USDC: 600 });
  });
});

describe("fetchPositions with an open Coinbase buy order", () => {
  function fakeCoinbase(opts: { failOrders?: boolean } = {}) {
    return {
      id: "coinbase",
      has: { fetchOpenOrders: true, fetchTickers: true },
      currencies: { BTC: { name: "Bitcoin" }, USDC: { name: "USDC" } },
      // What Coinbase returns after placing a $600 USDC buy: available drops, hold stays 0.
      fetchBalance: async () => ({
        free: { BTC: 0.5, USDC: 400 },
        used: { BTC: 0, USDC: 0 },
        total: { BTC: 0.5, USDC: 400 },
      }),
      fetchOpenOrders: async () => {
        if (opts.failOrders) throw new Error("nope");
        return [order({ symbol: "BTC/USDC", side: "buy", price: 60_000, amount: 0.01 })];
      },
      loadMarkets: async () => ({ "BTC/USD": {}, "BTC/USDC": {} }),
      fetchTickers: async () => ({ "BTC/USD": { last: 100_000 } }),
    } as unknown as Exchange;
  }

  it("includes the USDC reserved by the order", async () => {
    const { positions, warnings } = await fetchPositions(fakeCoinbase());
    expect(positions.find((p) => p.symbol === "USDC")?.quantity).toBe(1000);
    expect(positions.find((p) => p.symbol === "BTC")?.marketValue).toBe(50_000);
    expect(warnings).toEqual([]);
  });

  it("still returns balances, with a warning, if open orders can't be read", async () => {
    const { positions, warnings } = await fetchPositions(fakeCoinbase({ failOrders: true }));
    expect(positions.find((p) => p.symbol === "USDC")?.quantity).toBe(400);
    expect(warnings[0]).toMatch(/open orders/);
  });
});
