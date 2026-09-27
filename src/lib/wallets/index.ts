import { and, desc, eq, inArray } from "drizzle-orm";
import { localDate } from "@/lib/dates";
import type { DB } from "@/lib/db";
import { holdings, prices, settings, wallets, type Wallet } from "@/lib/db/schema";
import { chainById } from "./chains";
import { priceBalances } from "./pricing";
import type { ChainAdapter, ChainBalance } from "./types";

export const rpcSettingKey = (chainId: string) => `rpc:${chainId}`;

/** User-configured endpoints (one per line in Settings) first, then the chain's public defaults. */
export function rpcUrlsFor(db: DB, chain: ChainAdapter): string[] {
  const custom = db.select().from(settings).where(eq(settings.key, rpcSettingKey(chain.id))).get()?.value ?? "";
  const urls = custom
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  return [...new Set([...urls, ...chain.defaultRpcUrls])];
}

export const walletChains = (wallet: Pick<Wallet, "chains">): string[] => JSON.parse(wallet.chains) as string[];

export type WalletRefresh = { ok: boolean; error?: string; message?: string };

type ReadItem = { balance: ChainBalance; chain: ChainAdapter };
type Read = { wallet: Wallet; items: ReadItem[] } | { wallet: Wallet; error: string };

/** Reads balances on every chain the wallet is tracked on (network only, no writes). */
async function readWallet(db: DB, wallet: Wallet, fetchImpl: typeof fetch): Promise<Read> {
  const results = await Promise.all(
    walletChains(wallet).map(async (id): Promise<{ items: ReadItem[] } | { error: string }> => {
      const chain = chainById(id);
      if (!chain) return { error: `Unknown chain "${id}"` };
      try {
        const balances = await chain.fetchBalances(wallet.address, { rpcUrls: rpcUrlsFor(db, chain), fetch: fetchImpl });
        return { items: balances.map((balance) => ({ balance, chain })) };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  const errors = results.flatMap((r) => ("error" in r ? [r.error] : []));
  if (errors.length > 0) return { wallet, error: errors.join(" ") };
  return { wallet, items: results.flatMap((r) => ("items" in r ? r.items : [])) };
}

/** Latest stored crypto price per symbol (from wallet refreshes or the price feed), as a fallback. */
function storedPrices(db: DB, symbols: string[]): Map<string, { price: number; at: Date }> {
  const found = new Map<string, { price: number; at: Date }>();
  if (symbols.length === 0) return found;
  const rows = db
    .select()
    .from(prices)
    .where(and(eq(prices.kind, "crypto"), inArray(prices.symbol, symbols)))
    .orderBy(desc(prices.date), desc(prices.fetchedAt))
    .all();
  for (const r of rows) if (!found.has(r.symbol) && r.currency === "USD") found.set(r.symbol, { price: r.price, at: r.fetchedAt });
  return found;
}

/**
 * Replaces the wallet account's holdings with what was read. If any chain
 * couldn't be read, holdings are left as they were, since replacing them would
 * drop that chain's assets from the total. A price that can't be fetched falls
 * back to the last known one rather than valuing the asset at $0.
 */
function applyWallet(db: DB, read: Read, fetched: Map<string, number>, priceErrors: string[]): WalletRefresh {
  const { wallet } = read;
  if ("error" in read) {
    db.update(wallets).set({ status: "error", lastError: read.error }).where(eq(wallets.id, wallet.id)).run();
    return { ok: false, error: read.error };
  }

  // Only curated tokens are tracked; anything else at the address is almost always a spam airdrop.
  const tracked = read.items.filter((i) => i.balance.coingeckoId);
  const fallback = storedPrices(db, [...new Set(tracked.map((i) => i.balance.symbol))]);
  const now = new Date();
  const rows = tracked.map(({ balance, chain }) => {
    const fresh = fetched.get(balance.coingeckoId!);
    const last = fallback.get(balance.symbol);
    const price = fresh ?? last?.price ?? null;
    return {
      accountId: wallet.accountId,
      symbol: balance.symbol,
      name: balance.name,
      network: chain.id,
      // Holdings have no chain-specific id column; the security-id field holds the token contract.
      cusip: balance.contract,
      type: "crypto" as const,
      quantity: balance.amount,
      price,
      marketValue: price === null ? 0 : balance.amount * price,
      currency: "USD",
      priceSource: "feed" as const,
      priceAsOf: fresh !== undefined ? now : (last?.at ?? null),
    };
  });

  db.transaction((tx) => {
    tx.delete(holdings).where(eq(holdings.accountId, wallet.accountId)).run();
    if (rows.length > 0) tx.insert(holdings).values(rows).run();
    tx.update(wallets)
      .set({ status: "ok", lastError: null, lastRefreshedAt: now })
      .where(eq(wallets.id, wallet.id))
      .run();
  });

  const unpriced = rows.filter((r) => r.price === null).map((r) => r.symbol);
  // Price source problems only matter to wallets left with unpriced assets.
  const notes =
    unpriced.length > 0 ? [`No USD price for ${[...new Set(unpriced)].join(", ")} yet; shown with a $0 value.`, ...priceErrors] : [];
  return { ok: true, message: notes.length ? notes.join(" ") : undefined };
}

/** Fetches prices for everything read, in one request, and records them for later fallback. */
async function priceReads(db: DB, reads: Read[], fetchImpl: typeof fetch) {
  const balances = reads.flatMap((r) => ("items" in r ? r.items.map((i) => i.balance) : []));
  const { prices: fetched, errors } = await priceBalances(balances, fetchImpl);
  const date = localDate();
  const now = new Date();
  const symbolById = new Map(balances.filter((b) => b.coingeckoId).map((b) => [b.coingeckoId!, b.symbol]));
  db.transaction((tx) => {
    for (const [id, price] of fetched) {
      const symbol = symbolById.get(id);
      if (!symbol) continue;
      tx.insert(prices)
        .values({ symbol, kind: "crypto", date, price, currency: "USD", source: "coingecko", fetchedAt: now })
        .onConflictDoUpdate({
          target: [prices.symbol, prices.kind, prices.date, prices.source],
          set: { price, currency: "USD", fetchedAt: now },
        })
        .run();
    }
  });
  return { fetched, errors };
}

export async function refreshWallet(db: DB, walletId: string, fetchImpl: typeof fetch = fetch): Promise<WalletRefresh> {
  const wallet = db.select().from(wallets).where(eq(wallets.id, walletId)).get();
  if (!wallet) return { ok: false, error: "Wallet not found" };
  const read = await readWallet(db, wallet, fetchImpl);
  const { fetched, errors } = await priceReads(db, [read], fetchImpl);
  return applyWallet(db, read, fetched, errors);
}

/** Reads every wallet, then prices them all with a single request (public price APIs rate-limit bursts). */
export async function refreshAllWallets(db: DB, fetchImpl: typeof fetch = fetch) {
  const all = db.select().from(wallets).all();
  const reads: Read[] = [];
  // One wallet at a time: public RPC endpoints rate-limit bursts too.
  for (const w of all) reads.push(await readWallet(db, w, fetchImpl));
  const { fetched, errors } = await priceReads(db, reads, fetchImpl);
  return { count: all.length, results: reads.map((r) => applyWallet(db, r, fetched, errors)) };
}
