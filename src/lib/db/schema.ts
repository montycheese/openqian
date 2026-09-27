import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

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
    priceSource: text("price_source", { enum: ["manual", "import", "feed"] })
      .notNull()
      .default("manual"),
    priceAsOf: integer("price_as_of", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("holdings_account_idx").on(t.accountId)],
);

export type Category = typeof categories.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type HoldingType = (typeof holdingTypes)[number];
