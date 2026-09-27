import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";

let db: DB;
const result = { updated: 0, unpriced: [] as string[], errors: [] as string[] };

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prices", () => ({ refreshPrices: vi.fn(async () => result) }));

const { refreshPricesAction } = await import("@/lib/prices/actions");
const { revalidatePath } = await import("next/cache");

beforeEach(() => {
  db = openDatabase(":memory:");
  Object.assign(result, { updated: 0, unpriced: [], errors: [] });
});

describe("refreshPricesAction", () => {
  it("summarizes updates and names unpriced symbols", async () => {
    Object.assign(result, { updated: 3, unpriced: ["ZZZZ", "QQQQ"] });
    expect(await refreshPricesAction()).toEqual({
      ok: true,
      message: "Updated 3 holdings. No price found for ZZZZ, QQQQ; those keep their last value.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns an error when nothing could be refreshed", async () => {
    Object.assign(result, { errors: ["Yahoo Finance: timed out"] });
    expect(await refreshPricesAction()).toEqual({ error: "Couldn't refresh prices. Yahoo Finance: timed out." });
  });

  it("still succeeds when one provider failed but others updated", async () => {
    Object.assign(result, { updated: 1, errors: ["CoinGecko: rate limit reached, try again in a minute"] });
    expect(await refreshPricesAction()).toEqual({
      ok: true,
      message: "Updated 1 holding. CoinGecko: rate limit reached, try again in a minute.",
    });
  });
});
