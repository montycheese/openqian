import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHoldingsTable, parseNumber } from "@/lib/import/parse-holdings";
import { readTable } from "@/lib/import/read-table";

// All fixtures are synthetic: made-up accounts and numbers in each institution's layout.

const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("parseNumber", () => {
  it.each([
    ["$1,234.56", 1234.56],
    ["(12.50)", -12.5],
    ["-$3", -3],
    ["+$4.10", 4.1],
    ["12.5%", 12.5],
    ["-", null],
    ["N/A", null],
    ["", null],
  ])("%s → %s", (raw, expected) => expect(parseNumber(raw)).toBe(expected));
});

describe("Morgan Stanley Holdings Ungrouped (.xlsx)", () => {
  async function workbook() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Holdings");
    ws.getCell("A3").value = "All Product Type By Security";
    ws.getCell("A5").value = "Holdings for Institution Morgan Stanley as of 09/27/2026 11:15 AM ET";
    ws.getRow(8).values = ["Total Market Value:", 1310.5, "Accrued Interest*:", "-"];
    ws.getRow(11).values = [
      "Account Number", "Name", "Institution", "Product Type", "Open Order", "Symbol", "CUSIP", "Last ($)", "As of",
      "Quantity", "Market Value ($)", "Today's Change (%)", "Today's Change ($)", "Total Cost ($)", "Adjusted Cost ($)",
      "Prior Close - Market Value ($)", "Prior Close - Last ($)",
    ];
    ws.getRow(12).values = ["Joint - 1234", "ACME CORP", "Morgan Stanley", "Stocks / Options", "No", "ACME", "000000000", 100, "09/25/2026", 10, 1000, "-", "-", 400, 400, 1000, 100];
    ws.getRow(13).values = ["Joint - 1234", "SAMPLE S&P 500 ETF", "Morgan Stanley", "ETFs / CEFs", "No", "SMPL", "000000001", 50, "09/25/2026", 6, 300, "-", "-", 250, 250, 300, 50];
    ws.getRow(14).values = ["Joint - 1234", "BANK DEPOSIT PROGRAM", "Morgan Stanley", "Cash, MMF and BDP", "No", "MSPBNA", "000000002", "-", "-", "-", 10.5, "-", "-", "-", "-", 10.5, "-"];
    ws.getRow(15).values = ["Total", "-", "-", "-", "-", "-", "-", "-", "-", "-", 1310.5];
    ws.getCell("A25").value = "*Please note, accrued interest is based on prior day valuation...";
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  }

  it("parses positions, cash, cost basis, account, and date", async () => {
    const rows = await readTable("Holdings Ungrouped.xlsx", await workbook());
    const result = parseHoldingsTable(rows, "Holdings Ungrouped.xlsx");
    expect(result.institution).toBe("Morgan Stanley");
    expect(result.asOf).toBe("2026-09-27");
    expect(result.checksum).toEqual({ expected: 1310.5, actual: 1310.5, ok: true });
    expect(result.accounts).toHaveLength(1);
    const [acct] = result.accounts;
    expect(acct).toMatchObject({ name: "Joint", mask: "1234", total: 1310.5 });
    expect(acct.holdings).toEqual([
      { symbol: "ACME", name: "ACME CORP", type: "stock", quantity: 10, price: 100, marketValue: 1000, costBasis: 400 },
      { symbol: "SMPL", name: "SAMPLE S&P 500 ETF", type: "etf", quantity: 6, price: 50, marketValue: 300, costBasis: 250 },
      { symbol: "MSPBNA", name: "BANK DEPOSIT PROGRAM", type: "cash", quantity: null, price: null, marketValue: 10.5, costBasis: null },
    ]);
  });
});

describe("Fidelity-style positions CSV", () => {
  const file = csv(
    [
      "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Cost Basis Total,Average Cost Basis,Type",
      'Z00000001,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$250.00,,,,Cash',
      "Z00000001,Individual,ACME,ACME CORP,5,$20.00,+$0.10,$100.00,+$0.50,$80.00,$16.00,Cash",
      "X00000002,ROTH IRA,SMPL,SAMPLE ETF,2.5,$40.00,-$0.20,$100.00,-$0.50,$90.00,$36.00,Cash",
      "X00000002,ROTH IRA,Pending Activity,,,,,$5.00,,,,",
      "",
      '"The data and information in this spreadsheet is provided to you solely for your use..."',
      '"Date downloaded 09/26/2026 10:00 PM ET"',
    ].join("\n"),
  );

  it("groups by account and treats the core position as cash", async () => {
    const result = parseHoldingsTable(await readTable("Portfolio_Positions.csv", file), "Portfolio_Positions.csv");
    expect(result.asOf).toBe("2026-09-26");
    expect(result.accounts.map((a) => [a.name, a.mask, a.holdings.length, a.total])).toEqual([
      ["Individual", "0001", 2, 350],
      ["ROTH IRA", "0002", 2, 105],
    ]);
    expect(result.accounts[0].holdings[0]).toMatchObject({ symbol: "SPAXX", type: "cash", quantity: null, marketValue: 250 });
    expect(result.accounts[0].holdings[1]).toMatchObject({ symbol: "ACME", type: "stock", quantity: 5, costBasis: 80 });
    expect(result.checksum).toBeNull();
  });
});

describe("Schwab-style positions CSV", () => {
  const file = csv(
    [
      '"Positions for account Individual ...789 as of 09:00 PM ET, 09/26/2026","","",""',
      "",
      '"Symbol","Description","Qty (Quantity)","Price","Price Chng % (Price Change %)","Mkt Val (Market Value)","Cost Basis","Security Type"',
      '"ACME","ACME CORP","3","$10.00","1.2%","$30.00","$20.00","Equity"',
      '"Cash & Cash Investments","--","--","--","--","$70.00","--","Cash and Money Market"',
      '"Account Total","--","--","--","--","$100.00","$20.00","--"',
    ].join("\n"),
  );

  it("reads the account from the title and checks the total", async () => {
    const result = parseHoldingsTable(await readTable("Individual-Positions.csv", file), "Individual-Positions.csv");
    expect(result.institution).toBeNull();
    expect(result.asOf).toBe("2026-09-26");
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].mask).toBe("789");
    expect(result.accounts[0].holdings).toMatchObject([
      { symbol: "ACME", type: "stock", quantity: 3, marketValue: 30 },
      { symbol: null, name: "Cash & Cash Investments", type: "cash", marketValue: 70 },
    ]);
    expect(result.checksum?.ok).toBe(true);
  });

  it("flags totals that don't match", async () => {
    const broken = csv(
      ['"Symbol","Qty","Price","Market Value"', '"ACME","3","$10.00","$30.00"', '"Account Total","","","$999.00"'].join("\n"),
    );
    const result = parseHoldingsTable(await readTable("x.csv", broken), "x.csv");
    expect(result.checksum?.ok).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/don't add up/);
  });
});

it("rejects files without a positions table", async () => {
  expect(() => parseHoldingsTable([["Date", "Description", "Amount"], ["2026-01-01", "Coffee", "-4"]], "activity.csv")).toThrow(
    /positions table/,
  );
});
