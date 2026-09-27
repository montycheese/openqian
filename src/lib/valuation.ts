import type { Account, Category, Holding, Valuation } from "@/lib/db/schema";
import type { Converter } from "@/lib/money";

export type AccountSummary = {
  account: Account;
  /** Value in the account's own currency; null if empty or holdings span currencies. */
  native: { amount: number; currency: string } | null;
  /** Value in the base currency (convertible parts only). */
  base: number;
  /** Currencies whose amounts could not be converted to the base currency. */
  missingRates: string[];
  /** YYYY-MM-DD of the latest data point, if any. */
  asOf: string | null;
  isEmpty: boolean;
};

export type CategorySummary = {
  category: Category;
  accounts: AccountSummary[];
  /** Base-currency total of counted (not excluded) accounts. */
  total: number;
};

export type NetWorthSummary = {
  baseCurrency: string;
  assets: number;
  debts: number;
  netWorth: number;
  categories: CategorySummary[];
  missingRates: string[];
  hiddenCount: number;
};

const toDate = (d: Date) => d.toISOString().slice(0, 10);

/** Latest valuation per account: newest date, then newest entry that day. */
export function latestValuations(rows: Valuation[]): Map<string, Valuation> {
  const latest = new Map<string, Valuation>();
  for (const v of rows) {
    const cur = latest.get(v.accountId);
    if (
      !cur ||
      v.date > cur.date ||
      (v.date === cur.date && v.createdAt.getTime() > cur.createdAt.getTime())
    ) {
      latest.set(v.accountId, v);
    }
  }
  return latest;
}

export function summarizeAccount(
  account: Account,
  latest: Valuation | undefined,
  positions: Holding[],
  convert: Converter,
): AccountSummary {
  const missing = new Set<string>();
  const toBase = (amount: number, currency: string) => {
    const converted = convert(amount, currency);
    if (converted === null) missing.add(currency);
    return converted ?? 0;
  };

  if (account.kind === "value") {
    if (!latest) {
      return { account, native: null, base: 0, missingRates: [], asOf: null, isEmpty: true };
    }
    return {
      account,
      native: { amount: latest.value, currency: latest.currency },
      base: toBase(latest.value, latest.currency),
      missingRates: [...missing],
      asOf: latest.date,
      isEmpty: false,
    };
  }

  if (positions.length === 0) {
    return { account, native: null, base: 0, missingRates: [], asOf: null, isEmpty: true };
  }
  const currencies = new Set(positions.map((h) => h.currency));
  const base = positions.reduce((sum, h) => sum + toBase(h.marketValue, h.currency), 0);
  const native =
    currencies.size === 1
      ? { amount: positions.reduce((s, h) => s + h.marketValue, 0), currency: positions[0].currency }
      : null;
  const newest = positions.reduce((max, h) => {
    const t = (h.priceAsOf ?? h.updatedAt).getTime();
    return t > max ? t : max;
  }, 0);
  return {
    account,
    native,
    base,
    missingRates: [...missing],
    asOf: toDate(new Date(newest)),
    isEmpty: false,
  };
}

export function summarizeNetWorth(input: {
  baseCurrency: string;
  categories: Category[];
  accounts: Account[];
  valuations: Valuation[];
  holdings: Holding[];
  convert: Converter;
  includeHidden?: boolean;
}): NetWorthSummary {
  const latest = latestValuations(input.valuations);
  const holdingsByAccount = new Map<string, Holding[]>();
  for (const h of input.holdings) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }

  const visible = input.accounts.filter((a) => input.includeHidden || !a.isHidden);
  const missing = new Set<string>();
  let assets = 0;
  let debts = 0;

  const categories = [...input.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => {
      const accounts = visible
        .filter((a) => a.categoryId === category.id)
        .map((a) => summarizeAccount(a, latest.get(a.id), holdingsByAccount.get(a.id) ?? [], input.convert))
        .sort((a, b) => b.base - a.base || a.account.name.localeCompare(b.account.name));
      let total = 0;
      for (const s of accounts) {
        if (s.account.isExcluded || s.account.isHidden) continue;
        total += s.base;
        s.missingRates.forEach((c) => missing.add(c));
      }
      if (category.kind === "asset") assets += total;
      else debts += total;
      return { category, accounts, total };
    });

  return {
    baseCurrency: input.baseCurrency,
    assets,
    debts,
    netWorth: assets - debts,
    categories,
    missingRates: [...missing].sort(),
    hiddenCount: input.accounts.filter((a) => a.isHidden).length,
  };
}
