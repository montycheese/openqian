import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";

let db: DB;

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/lib/fx/actions");
const { setBaseCurrency } = await import("@/lib/actions");
const { accounts, categories, fxRates } = await import("@/lib/db/schema");
const { loadConverter } = await import("@/lib/fx");

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  db = openDatabase(":memory:");
  const cat = db.select().from(categories).all()[0];
  db.insert(accounts).values({ name: "Euro", categoryId: cat.id, kind: "value", currency: "EUR" }).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveManualRate", () => {
  it("stores 1 currency = rate base", async () => {
    expect(await actions.saveManualRate({}, form({ currency: "eur", rate: "1.25" }))).toEqual({ ok: true });
    expect(db.select().from(fxRates).all()).toMatchObject([{ base: "EUR", quote: "USD", rate: 1.25, source: "manual" }]);
    expect(loadConverter(db, "USD")(100, "EUR")).toBeCloseTo(125);
  });

  it.each([
    [{ currency: "EUR", rate: "0" }, "Rate must be more than 0"],
    [{ currency: "EUR", rate: "-1" }, "Rate must be more than 0"],
    [{ currency: "EUR", rate: "abc" }, "Enter a rate"],
    [{ currency: "EURO", rate: "1" }, "Pick a 3-letter currency code"],
    [{ currency: "USD", rate: "1" }, "USD is already the base currency"],
  ])("rejects %o", async (values, error) => {
    expect(await actions.saveManualRate({}, form(values))).toEqual({ error });
    expect(db.select().from(fxRates).all()).toEqual([]);
  });
});

describe("clearManualRateAction", () => {
  it("removes the manual override", async () => {
    await actions.saveManualRate({}, form({ currency: "EUR", rate: "1.25" }));
    expect(await actions.clearManualRateAction({}, form({ base: "EUR", quote: "USD" }))).toEqual({ ok: true });
    expect(db.select().from(fxRates).all()).toEqual([]);
  });
});

describe("refreshFxAction", () => {
  it("reports network errors", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await actions.refreshFxAction()).toEqual({ error: "Couldn't refresh rates: fetch failed" });
  });

  it("warns about unsupported currencies", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json(
        url.endsWith("/currencies")
          ? [{ iso_code: "USD" }, { iso_code: "EUR" }]
          : [{ date: "2026-09-25", base: "USD", quote: "EUR", rate: 0.8 }],
      ),
    );
    const cat = db.select().from(categories).all()[0];
    db.insert(accounts).values({ name: "Gold", categoryId: cat.id, kind: "value", currency: "XAU" }).run();
    const res = await actions.refreshFxAction();
    expect(res).toEqual({ ok: true, message: "No published rate for XAU. Set one manually below." });
    expect(loadConverter(db, "USD")(80, "EUR")).toBeCloseTo(100);
  });
});

describe("changing the base currency", () => {
  it("keeps converting through rates fetched against the old base", async () => {
    await actions.saveManualRate({}, form({ currency: "EUR", rate: "1.25" }));
    await setBaseCurrency({}, form({ baseCurrency: "EUR" }));
    expect(loadConverter(db, "EUR")(125, "USD")).toBeCloseTo(100);
  });
});
