import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { holdings, settings, wallets, type Wallet } from "@/lib/db/schema";
import { chainById } from "./chains";
import { priceBalances, priceKey, type PricedInput } from "./pricing";
import type { ChainAdapter } from "./types";

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

/**
 * Reads balances on every chain the wallet is tracked on and replaces the
 * account's holdings. If any chain can't be read, holdings are left as they
 * were, since replacing them would drop that chain's assets from the total.
 */
export async function refreshWallet(db: DB, walletId: string, fetchImpl: typeof fetch = fetch): Promise<WalletRefresh> {
  const wallet = db.select().from(wallets).where(eq(wallets.id, walletId)).get();
  if (!wallet) return { ok: false, error: "Wallet not found" };

  const results = await Promise.all(
    walletChains(wallet).map(async (id) => {
      const chain = chainById(id);
      if (!chain) return { chain: null, error: `Unknown chain "${id}"` };
      try {
        const balances = await chain.fetchBalances(wallet.address, { rpcUrls: rpcUrlsFor(db, chain), fetch: fetchImpl });
        return { chain, balances };
      } catch (err) {
        return { chain, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const failures = results.flatMap((r) => ("error" in r && r.error ? [r.error] : []));
  if (failures.length > 0) {
    const error = failures.join(" ");
    db.update(wallets).set({ status: "error", lastError: error }).where(eq(wallets.id, walletId)).run();
    return { ok: false, error };
  }

  const items: (PricedInput & { chain: ChainAdapter })[] = results.flatMap((r) =>
    "balances" in r && r.chain ? r.balances!.map((balance) => ({ balance, platform: r.chain!.coingeckoPlatform, chain: r.chain! })) : [],
  );
  const { prices, errors } = await priceBalances(items, fetchImpl);

  const now = new Date();
  const rows = items.flatMap(({ balance, platform, chain }) => {
    const key = priceKey({ balance, platform });
    const price = key ? (prices.get(key) ?? null) : null;
    // Tokens outside the curated lists that CoinGecko doesn't know are almost always spam airdrops.
    if (!balance.coingeckoId && price === null) return [];
    const multiChain = walletChains(wallet).length > 1;
    return [
      {
        accountId: wallet.accountId,
        symbol: balance.symbol,
        name: multiChain ? `${balance.name} · ${chain.label}` : balance.name,
        // Holdings have no chain-specific id column; the security-id field holds the token contract.
        cusip: balance.contract,
        type: "crypto" as const,
        quantity: balance.amount,
        price,
        marketValue: price === null ? 0 : balance.amount * price,
        currency: "USD",
        priceSource: "feed" as const,
        priceAsOf: price === null ? null : now,
      },
    ];
  });

  db.transaction((tx) => {
    tx.delete(holdings).where(eq(holdings.accountId, wallet.accountId)).run();
    if (rows.length > 0) tx.insert(holdings).values(rows).run();
    tx.update(wallets)
      .set({ status: "ok", lastError: null, lastRefreshedAt: now })
      .where(eq(wallets.id, walletId))
      .run();
  });

  const unpriced = rows.filter((r) => r.price === null).map((r) => r.symbol);
  const notes = [
    unpriced.length > 0 && `No USD price for ${[...new Set(unpriced)].join(", ")}; shown with a $0 value.`,
    ...errors,
  ].filter(Boolean);
  return { ok: true, message: notes.length ? notes.join(" ") : undefined };
}

export async function refreshAllWallets(db: DB, fetchImpl: typeof fetch = fetch) {
  const all = db.select({ id: wallets.id }).from(wallets).all();
  // Sequential: public RPCs and CoinGecko rate-limit bursts.
  const results: WalletRefresh[] = [];
  for (const w of all) results.push(await refreshWallet(db, w.id, fetchImpl));
  return { count: all.length, results };
}
