import { asc, count, desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { accounts, categories, connections, holdings, imports, settings, valuations, wallets } from "@/lib/db/schema";
import { listRates, loadConverter } from "@/lib/fx";
import type { ChartPoint } from "@/lib/chart";
import { getAccountHistory, getNetWorthHistory } from "@/lib/history";
import { DEFAULT_BASE_CURRENCY } from "@/lib/money";
import { summarizeAccount, summarizeNetWorth } from "@/lib/valuation";

export async function getBaseCurrency(): Promise<string> {
  await connection();
  const row = getDb().select().from(settings).where(eq(settings.key, "base_currency")).get();
  return row?.value ?? DEFAULT_BASE_CURRENCY;
}

export async function listCategories() {
  await connection();
  return getDb().select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
}

export async function getNetWorth(opts: { includeHidden?: boolean } = {}) {
  const baseCurrency = await getBaseCurrency();
  const db = getDb();
  return summarizeNetWorth({
    baseCurrency,
    categories: db.select().from(categories).all(),
    accounts: db.select().from(accounts).all(),
    valuations: db.select().from(valuations).all(),
    holdings: db.select().from(holdings).all(),
    convert: loadConverter(db, baseCurrency),
    includeHidden: opts.includeHidden,
  });
}

export async function getAccountDetail(id: string) {
  const baseCurrency = await getBaseCurrency();
  const db = getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) return null;
  const category = db.select().from(categories).where(eq(categories.id, account.categoryId)).get()!;
  const history = db
    .select()
    .from(valuations)
    .where(eq(valuations.accountId, id))
    .orderBy(desc(valuations.date), desc(valuations.createdAt))
    .all();
  const positions = db
    .select()
    .from(holdings)
    .where(eq(holdings.accountId, id))
    .orderBy(desc(holdings.marketValue))
    .all();
  const summary = summarizeAccount(account, history[0], positions, loadConverter(db, baseCurrency));
  const link = db.select().from(connections).where(eq(connections.accountId, id)).get() ?? null;
  const wallet = db.select().from(wallets).where(eq(wallets.accountId, id)).get() ?? null;
  const lastImport =
    db.select().from(imports).where(eq(imports.accountId, id)).orderBy(desc(imports.createdAt)).limit(1).get() ?? null;
  return { account, category, history, positions, summary, baseCurrency, link, wallet, lastImport };
}

export async function getFxRates() {
  const baseCurrency = await getBaseCurrency();
  return listRates(getDb(), baseCurrency);
}

/** How many sources "Refresh all" pulls balances from. */
export async function countSyncedSources(): Promise<{ exchanges: number; wallets: number }> {
  await connection();
  const db = getDb();
  return {
    exchanges: db.select({ n: count() }).from(connections).get()?.n ?? 0,
    wallets: db.select({ n: count() }).from(wallets).get()?.n ?? 0,
  };
}

/** Every net worth snapshot in the base currency, oldest first. */
export async function getNetWorthSeries(): Promise<{ baseCurrency: string; points: ChartPoint[] }> {
  const baseCurrency = await getBaseCurrency();
  const points = getNetWorthHistory(getDb(), { range: "all", baseCurrency }).map((p) => ({
    date: p.date,
    value: p.netWorth,
  }));
  return { baseCurrency, points };
}

/** An account's base-currency value in every snapshot, oldest first. */
export async function getAccountSeries(id: string, baseCurrency: string): Promise<ChartPoint[]> {
  await connection();
  return getAccountHistory(getDb(), id, { range: "all", baseCurrency }).map((p) => ({
    date: p.date,
    value: p.baseValue,
  }));
}

/** Custom RPC endpoints per chain id (empty when using the defaults). */
export async function getRpcOverrides(): Promise<Record<string, string>> {
  await connection();
  const rows = getDb().select().from(settings).all();
  return Object.fromEntries(rows.filter((r) => r.key.startsWith("rpc:")).map((r) => [r.key.slice(4), r.value]));
}
