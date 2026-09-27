"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { accounts, categories, settings, wallets } from "@/lib/db/schema";
import { recordSnapshot } from "@/lib/snapshots";
import { CHAINS, chainsInFamily, detectFamily } from "./chains";
import { refreshAllWallets, refreshWallet, rpcSettingKey } from "./index";

const FAMILY_LABELS = { evm: "EVM wallet", solana: "Solana wallet", bitcoin: "Bitcoin wallet" } as const;

export async function addWallet(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ address: z.string().trim().min(1, "Enter a wallet address"), name: z.string().trim() })
    .safeParse({ address: formData.get("address"), name: formData.get("name") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const detected = detectFamily(parsed.data.address);
  if (!detected) {
    return { error: "That doesn't look like an Ethereum/EVM (0x…), Solana, or Bitcoin address." };
  }
  const { family, address } = detected;
  const familyChains = chainsInFamily(family).map((c) => c.id);
  const chosen = family === "evm" ? formData.getAll("chains").map(String).filter((c) => familyChains.includes(c)) : familyChains;
  if (chosen.length === 0) return { error: "Choose at least one network" };

  const db = getDb();
  if (db.select().from(wallets).where(and(eq(wallets.family, family), eq(wallets.address, address))).get()) {
    return { error: "This address is already being tracked" };
  }
  const crypto = db.select().from(categories).all().find((c) => c.name === "Crypto" && c.kind === "asset");
  const category = crypto ?? db.select().from(categories).where(eq(categories.kind, "asset")).get();
  if (!category) return { error: "Create an asset category first" };

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const [account] = db
    .insert(accounts)
    .values({
      name: parsed.data.name || `${chainsInFamily(family)[0].label} ${short}`,
      institution: FAMILY_LABELS[family],
      categoryId: category.id,
      kind: "holdings",
      currency: "USD",
      source: "connection",
      accountMask: address.slice(-4),
    })
    .returning()
    .all();
  const [wallet] = db
    .insert(wallets)
    .values({ accountId: account.id, family, address, chains: JSON.stringify(chosen) })
    .returning()
    .all();

  // Keep the wallet even if the first read fails: public endpoints can be briefly unavailable.
  const result = await refreshWallet(db, wallet.id);
  recordSnapshot();
  revalidatePath("/", "layout");
  return result.ok
    ? { ok: true, message: result.message }
    : { ok: true, message: `Wallet added, but balances couldn't be loaded yet: ${result.error} Try Refresh later.` };
}

export async function refreshWalletAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await refreshWallet(getDb(), z.string().parse(formData.get("id")));
  recordSnapshot();
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

/** Wallet step of "Refresh all": no snapshot or revalidation of its own. */
export async function refreshWalletsStep(): Promise<ActionState> {
  const { count, results } = await refreshAllWallets(getDb());
  const failed = results.filter((r) => !r.ok);
  const notes = results.map((r) => r.message).filter(Boolean);
  if (failed.length > 0) {
    return { error: `${failed.length} of ${count} wallets failed to refresh: ${failed.map((r) => r.error).join(" ")}` };
  }
  return { ok: true, message: notes.length ? notes.join(" ") : undefined };
}

/** Stops tracking the address; the account and its last balances stay. */
export async function removeWallet(_: ActionState, formData: FormData): Promise<ActionState> {
  const db = getDb();
  const wallet = db.select().from(wallets).where(eq(wallets.id, z.string().parse(formData.get("id")))).get();
  if (!wallet) return { error: "Wallet not found" };
  db.delete(wallets).where(eq(wallets.id, wallet.id)).run();
  db.update(accounts).set({ source: "manual" }).where(eq(accounts.id, wallet.accountId)).run();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Saves custom RPC endpoints (one per line) for a chain; empty restores the defaults. */
export async function saveRpcUrls(_: ActionState, formData: FormData): Promise<ActionState> {
  const chainId = z.enum(CHAINS.map((c) => c.id) as [string, ...string[]]).safeParse(formData.get("chain"));
  if (!chainId.success) return { error: "Unknown chain" };
  const urls = String(formData.get("urls") ?? "")
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const invalid = urls.find((u) => !/^https?:\/\/\S+$/.test(u));
  if (invalid) return { error: `Not a URL: ${invalid}` };
  const db = getDb();
  const key = rpcSettingKey(chainId.data);
  if (urls.length === 0) db.delete(settings).where(eq(settings.key, key)).run();
  else
    db.insert(settings)
      .values({ key, value: urls.join("\n") })
      .onConflictDoUpdate({ target: settings.key, set: { value: urls.join("\n") } })
      .run();
  revalidatePath("/", "layout");
  return { ok: true };
}
