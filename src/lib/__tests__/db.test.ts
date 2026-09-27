import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, openDatabase } from "@/lib/db";
import { accounts, categories, valuations } from "@/lib/db/schema";

describe("openDatabase", () => {
  it("migrates, seeds categories, and cascades deletes", () => {
    const db = openDatabase(":memory:");
    const cats = db.select().from(categories).all();
    expect(cats).toHaveLength(DEFAULT_CATEGORIES.length);

    const [acct] = db
      .insert(accounts)
      .values({ name: "Checking", categoryId: cats[0].id, kind: "value", currency: "USD" })
      .returning()
      .all();
    db.insert(valuations).values({ accountId: acct.id, date: "2026-09-01", value: 1, currency: "USD" }).run();
    db.delete(accounts).run();
    expect(db.select().from(valuations).all()).toHaveLength(0);
  });
});

describe("migrations added after the database was opened", () => {
  it("are detected by migrationsVersion and applied by migrate", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { migrationsVersion } = await import("@/lib/db");

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "oc-migrations-"));
    fs.cpSync(path.join(process.cwd(), "drizzle"), folder, { recursive: true });
    const db = openDatabase(":memory:", folder);
    const before = migrationsVersion(folder);

    fs.writeFileSync(path.join(folder, "9999_probe.sql"), "CREATE TABLE `probe` (`id` integer PRIMARY KEY);");
    const journalPath = path.join(folder, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.entries.push({ ...journal.entries.at(-1), idx: journal.entries.length, tag: "9999_probe", when: Date.now() });
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    expect(migrationsVersion(folder)).not.toBe(before);
    migrate(db, { migrationsFolder: folder });
    const { sql } = await import("drizzle-orm");
    expect(db.get(sql`select name from sqlite_master where name = 'probe'`)).toBeTruthy();
    fs.rmSync(folder, { recursive: true });
  });
});
