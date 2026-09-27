import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dataDir } from "@/lib/paths";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

export const DEFAULT_CATEGORIES: { name: string; kind: "asset" | "debt" }[] = [
  { name: "Cash", kind: "asset" },
  { name: "Investments", kind: "asset" },
  { name: "Retirement", kind: "asset" },
  { name: "Crypto", kind: "asset" },
  { name: "Private Equity", kind: "asset" },
  { name: "Real Estate", kind: "asset" },
  { name: "Other Assets", kind: "asset" },
  { name: "Credit Cards", kind: "debt" },
  { name: "Loans", kind: "debt" },
  { name: "Mortgages", kind: "debt" },
];

/** Opens (or creates) a database, applies migrations, and seeds defaults. */
export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  seed(db);
  return db;
}

function seed(db: DB) {
  if (db.select().from(schema.categories).limit(1).all().length > 0) return;
  db.insert(schema.categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .run();
}

const globalForDb = globalThis as unknown as { openchiengDb?: DB };

/** Shared connection, reused across dev hot reloads. */
export function getDb(): DB {
  globalForDb.openchiengDb ??= openDatabase(path.join(dataDir(), "openchieng.db"));
  return globalForDb.openchiengDb;
}
