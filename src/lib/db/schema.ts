import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdateFn(() => new Date());

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Provider credentials, encrypted with the master key (see lib/secrets.ts). */
export const secrets = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["asset", "debt"] }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    name: text("name").notNull(),
    institution: text("institution"),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    /** "value": a single value tracked over time. "holdings": sum of positions. */
    kind: text("kind", { enum: ["value", "holdings"] }).notNull(),
    currency: text("currency").notNull(),
    source: text("source", { enum: ["manual", "import", "connection"] })
      .notNull()
      .default("manual"),
    /** Last digits of the institution's account number, used to match imports. */
    accountMask: text("account_mask"),
    notes: text("notes"),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    isExcluded: integer("is_excluded", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_category_idx").on(t.categoryId)],
);

/** Dated values for "value" accounts (custom assets, balances, debts). */
export const valuations = sqliteTable(
  "valuations",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    value: real("value").notNull(),
    /** Optional breakdown, e.g. private shares: quantity × unit price. */
    quantity: real("quantity"),
    unitPrice: real("unit_price"),
    currency: text("currency").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("valuations_account_date_idx").on(t.accountId, t.date)],
);

export const holdingTypes = ["stock", "etf", "fund", "crypto", "cash", "bond", "option", "other"] as const;

/** Positions inside "holdings" accounts. */
export const holdings = sqliteTable(
  "holdings",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol"),
    name: text("name").notNull(),
    cusip: text("cusip"),
    type: text("type", { enum: holdingTypes }).notNull().default("stock"),
    /** Null for value-only positions such as cash sweeps. */
    quantity: real("quantity"),
    price: real("price"),
    marketValue: real("market_value").notNull(),
    currency: text("currency").notNull(),
    costBasis: real("cost_basis"),
    /** Blockchain the asset is held on (wallet chain id, e.g. "base"); null off-chain. */
    network: text("network"),
    priceSource: text("price_source", { enum: ["manual", "import", "feed"] })
      .notNull()
      .default("manual"),
    priceAsOf: integer("price_as_of", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("holdings_account_idx").on(t.accountId)],
);

export const exchanges = ["coinbase", "kraken", "gemini", "binanceus"] as const;

/** API connections (crypto exchanges now; brokerage APIs later). Credentials live in `secrets`. */
export const connections = sqliteTable("connections", {
  id: id(),
  provider: text("provider", { enum: ["ccxt"] }).notNull(),
  /** ccxt exchange id, e.g. "coinbase". */
  exchange: text("exchange", { enum: exchanges }).notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
  lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const chainFamilies = ["evm", "solana", "bitcoin"] as const;

/**
 * Watch-only blockchain addresses. One account per address; an EVM address is
 * tracked on every network listed in `chains`.
 */
export const wallets = sqliteTable(
  "wallets",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    family: text("family", { enum: chainFamilies }).notNull(),
    address: text("address").notNull(),
    /** JSON array of chain ids, e.g. ["ethereum","base","arbitrum"]. */
    chains: text("chains").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
    lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("wallets_family_address_idx").on(t.family, t.address)],
);

/** One row per applied file import (the file itself is never stored). */
export const imports = sqliteTable("imports", {
  id: id(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  asOf: text("as_of").notNull(),
  positions: integer("positions").notNull(),
  totalValue: real("total_value").notNull(),
  createdAt: createdAt(),
});

/** Cached quotes from price feeds, one per symbol per day per source. */
export const prices = sqliteTable(
  "prices",
  {
    id: id(),
    /** Ticker as stored on holdings (e.g. "VOO", "BTC"). */
    symbol: text("symbol").notNull(),
    kind: text("kind", { enum: ["security", "crypto"] }).notNull(),
    /** YYYY-MM-DD of the quote. */
    date: text("date").notNull(),
    price: real("price").notNull(),
    currency: text("currency").notNull(),
    source: text("source").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("prices_symbol_kind_date_source_idx").on(t.symbol, t.kind, t.date, t.source)],
);

/** Exchange rates: 1 `base` = `rate` `quote`. Manual rows override fetched ones. */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: id(),
    /** YYYY-MM-DD the rate applies to. */
    date: text("date").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: real("rate").notNull(),
    source: text("source", { enum: ["frankfurter", "manual"] }).notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("fx_rates_date_pair_source_idx").on(t.date, t.base, t.quote, t.source)],
);

/** Net worth for one day; the latest capture of a day replaces earlier ones. */
export const snapshots = sqliteTable("snapshots", {
  id: id(),
  /** YYYY-MM-DD, one row per day. */
  date: text("date").notNull().unique(),
  baseCurrency: text("base_currency").notNull(),
  assets: real("assets").notNull(),
  debts: real("debts").notNull(),
  netWorth: real("net_worth").notNull(),
  /** JSON map of currency → base units per 1 unit, as used for this snapshot. */
  fxRates: text("fx_rates").notNull().default("{}"),
  /**
   * True for days reconstructed from valuation history that are missing some
   * accounts (e.g. holdings, which keep no history), so the totals understate
   * net worth. Only per-account history uses these.
   */
  partial: integer("partial", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Each account's value within a snapshot. */
export const snapshotAccounts = sqliteTable(
  "snapshot_accounts",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    // No FK: history keeps rows for accounts deleted later.
    accountId: text("account_id").notNull(),
    categoryId: text("category_id").notNull(),
    nativeValue: real("native_value"),
    nativeCurrency: text("native_currency"),
    baseValue: real("base_value").notNull(),
    /** False when excluded or hidden, i.e. not part of that day's totals. */
    counted: integer("counted", { mode: "boolean" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.accountId] }), index("snapshot_accounts_account_idx").on(t.accountId)],
);

export type Category = typeof categories.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type HoldingType = (typeof holdingTypes)[number];
export type Connection = typeof connections.$inferSelect;
export type ExchangeId = (typeof exchanges)[number];
export type Price = typeof prices.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type ChainFamily = (typeof chainFamilies)[number];
export type SnapshotAccount = typeof snapshotAccounts.$inferSelect;
