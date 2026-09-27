import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DB } from "@/lib/db";

let db: DB;
vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { applyImport, previewImport } = await import("@/lib/import/actions");
const { accounts, categories, holdings, imports, valuations } = await import("@/lib/db/schema");

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
    expect(first.preview!.balances).toBeNull();
    expect(first.preview!.holdings!.matches).toEqual([null]);

    const investments = db.select().from(categories).all().find((c) => c.name === "Investments")!;
    const payload = (target: string, preview = first.preview!) =>
      JSON.stringify({
        fileName: preview.fileName,
        institution: "Fidelity",
        asOf: preview.holdings!.asOf,
        accounts: preview.holdings!.accounts.map((a) => ({ target, name: "Fidelity Individual", categoryId: investments.id, currency: "USD", mask: a.mask, holdings: a.holdings })),
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
    expect(second.preview!.holdings!.matches).toEqual([account.id]);
    const fd2 = new FormData();
    fd2.set("payload", payload(account.id, second.preview!));
    await applyImport({}, fd2);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(holdings).all().map((h) => h.marketValue).sort()).toEqual([120, 50]);
    expect(db.select().from(imports).all()).toHaveLength(2);
  });

  it("imports OFX balances, treating credit card debt as a positive debt amount", async () => {
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>1<ACCTID>000011112222<ACCTTYPE>CHECKING</BANKACCTFROM>
<LEDGERBAL><BALAMT>1500.00<DTASOF>20260926</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD<CCACCTFROM><ACCTID>4000000000009999</CCACCTFROM>
<LEDGERBAL><BALAMT>-300.00<DTASOF>20260926</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const preview = (await previewImport({}, upload(ofx, "Chase_Activity.QFX"))).preview!;
    expect(preview.holdings).toBeNull();
    expect(preview.balances!.institution).toBe("Chase");

    const cat = (name: string) => db.select().from(categories).all().find((c) => c.name === name)!.id;
    const apply = async (targets: string[]) => {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          fileName: preview.fileName,
          institution: "Chase",
          asOf: preview.balances!.asOf,
          balances: preview.balances!.accounts.map((a, i) => ({
            target: targets[i],
            name: `Chase ${a.name}`,
            categoryId: a.kind === "credit" ? cat("Credit Cards") : cat("Cash"),
            currency: a.currency,
            mask: a.mask,
            balance: a.balance,
            asOf: a.asOf,
          })),
        }),
      );
      return applyImport({}, fd);
    };
    expect((await apply(["new", "new"])).imported).toHaveLength(2);
    const rows = db.select().from(valuations).all();
    expect(rows.map((v) => v.value).sort((a, b) => a - b)).toEqual([300, 1500]);

    // Importing the same statement again into the matched accounts doesn't duplicate values.
    const again = (await previewImport({}, upload(ofx, "Chase_Activity.QFX"))).preview!;
    await apply(again.balances!.matches as string[]);
    expect(db.select().from(valuations).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
  });

  it("rejects unsupported and unreadable files", async () => {
    expect((await previewImport({}, upload("x", "statement.pdf"))).error).toMatch(/Unsupported/);
    expect((await previewImport({}, upload("Date,Amount\n2026-01-01,4"))).error).toMatch(/positions table/);
  });
});
