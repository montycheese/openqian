import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";

let db: DB;
vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { applyImport, previewImport } = await import("@/lib/import/actions");
const { accounts, categories, holdings, imports } = await import("@/lib/db/schema");

const csv = [
  "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total",
  "Z00001234,Individual,ACME,ACME CORP,5,$20.00,$100.00,$80.00",
  "Z00001234,Individual,SPAXX**,MONEY MARKET,,,$50.00,",
  '"Date downloaded 09/26/2026 10:00 PM ET"',
].join("\n");

const upload = (text: string, name = "Positions.csv") => {
  const fd = new FormData();
  fd.set("file", new File([text], name));
  return fd;
};

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("import flow", () => {
  it("previews, creates a new account, then re-import matches it by account number", async () => {
    const first = await previewImport({}, upload(csv));
    expect(first.error).toBeUndefined();
    expect(first.preview!.matches).toEqual([null]);

    const investments = db.select().from(categories).all().find((c) => c.name === "Investments")!;
    const payload = (target: string, p = first.preview!) =>
      JSON.stringify({
        fileName: p.fileName,
        institution: "Fidelity",
        asOf: p.asOf,
        accounts: p.accounts.map((a) => ({ target, name: "Fidelity Individual", categoryId: investments.id, currency: "USD", mask: a.mask, holdings: a.holdings })),
      });
    const fd = new FormData();
    fd.set("payload", payload("new"));
    const applied = await applyImport({}, fd);
    expect(applied.imported).toHaveLength(1);

    const account = db.select().from(accounts).get()!;
    expect(account).toMatchObject({ name: "Fidelity Individual", accountMask: "1234", source: "import", kind: "holdings" });
    expect(db.select().from(holdings).all()).toHaveLength(2);

    // A newer export replaces positions in the matched account.
    const second = await previewImport({}, upload(csv.replace("ACME CORP,5,$20.00,$100.00", "ACME CORP,6,$20.00,$120.00")));
    expect(second.preview!.matches).toEqual([account.id]);
    const fd2 = new FormData();
    fd2.set("payload", payload(account.id, second.preview!));
    await applyImport({}, fd2);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(holdings).all().map((h) => h.marketValue).sort()).toEqual([120, 50]);
    expect(db.select().from(imports).all()).toHaveLength(2);
  });

  it("rejects unsupported and unreadable files", async () => {
    expect((await previewImport({}, upload("x", "statement.pdf"))).error).toMatch(/Unsupported/);
    expect((await previewImport({}, upload("Date,Amount\n2026-01-01,4"))).error).toMatch(/positions table/);
  });
});
