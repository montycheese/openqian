import { asc, count, desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { accounts, categories, connections, holdings, imports, settings, valuations } from "@/lib/db/schema";
import { DEFAULT_BASE_CURRENCY, sameCurrencyConverter } from "@/lib/money";
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
    convert: sameCurrencyConverter(baseCurrency),
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
  const summary = summarizeAccount(account, history[0], positions, sameCurrencyConverter(baseCurrency));
  const link = db.select().from(connections).where(eq(connections.accountId, id)).get() ?? null;
  const lastImport =
    db.select().from(imports).where(eq(imports.accountId, id)).orderBy(desc(imports.createdAt)).limit(1).get() ?? null;
  return { account, category, history, positions, summary, baseCurrency, link, lastImport };
}

export async function countConnections(): Promise<number> {
  await connection();
  return getDb().select({ n: count() }).from(connections).get()?.n ?? 0;
}
