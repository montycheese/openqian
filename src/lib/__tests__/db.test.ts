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
