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

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Opens (or creates) a database, applies migrations, and seeds defaults. */
export function openDatabase(file: string, migrationsFolder = MIGRATIONS_FOLDER): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  seed(db);
  return db;
}

/** Identifies the set of migrations on disk, so new ones can be detected. */
export function migrationsVersion(migrationsFolder = MIGRATIONS_FOLDER): string {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries.map((e) => e.tag).join(",");
}

function seed(db: DB) {
  if (db.select().from(schema.categories).limit(1).all().length > 0) return;
  db.insert(schema.categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .run();
}

const globalForDb = globalThis as unknown as { openchiengDbV2?: { db: DB; migrations: string } };

/**
 * Shared connection, reused across dev hot reloads. Because the connection
 * outlives code changes in development, migrations added while `next dev` is
 * running are applied on the next access instead of only at startup.
 */
export function getDb(): DB {
  const cached = globalForDb.openchiengDbV2;
  if (!cached) {
    const migrations = migrationsVersion();
    const db = openDatabase(path.join(dataDir(), "openchieng.db"));
    globalForDb.openchiengDbV2 = { db, migrations };
    return db;
  }
  if (process.env.NODE_ENV !== "production") {
    const migrations = migrationsVersion();
    if (migrations !== cached.migrations) {
      migrate(cached.db, { migrationsFolder: MIGRATIONS_FOLDER });
      cached.migrations = migrations;
    }
  }
  return cached.db;
}
