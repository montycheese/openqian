import { describe, expect, it } from "vitest";
import { parseOfx, parseOfxTree } from "@/lib/import/ofx";

// Synthetic files in the shapes banks export; all account data is made up.

const SGML_HEADER = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE
`;

const chaseChecking = `${SGML_HEADER}
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260926120000[0:GMT]
<LANGUAGE>ENG
<FI><ORG>B1<FID>10898</FI>
<INTU.BID>10898
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>000000000
<ACCTID>000000001234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801
<DTEND>20260926
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260920
<TRNAMT>-4.50
<FITID>1
<NAME>COFFEE &amp; CO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>12500.25
<DTASOF>20260926120000.000[-4:EDT]
</LEDGERBAL>
<AVAILBAL>
<BALAMT>12400.00
<DTASOF>20260926
</AVAILBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

const wellsFargoXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
    <DTSERVER>20260925080000</DTSERVER><LANGUAGE>ENG</LANGUAGE>
    <FI><ORG>Wells Fargo</ORG><FID>3000</FID></FI></SONRS></SIGNONMSGSRSV1>
  <BANKMSGSRSV1><STMTTRNRS><TRNUID>0</TRNUID>
    <STMTRS><CURDEF>USD</CURDEF>
      <BANKACCTFROM><BANKID>000000000</BANKID><ACCTID>9876545678</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTFROM>
      <BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260925</DTEND><MEMO></MEMO></BANKTRANLIST>
      <LEDGERBAL><BALAMT>3000.00</BALAMT><DTASOF>20260925</DTASOF></LEDGERBAL>
    </STMTRS></STMTTRNRS></BANKMSGSRSV1>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0</TRNUID>
    <CCSTMTRS><CURDEF>USD</CURDEF>
      <CCACCTFROM><ACCTID>4000000000004321</ACCTID></CCACCTFROM>
      <LEDGERBAL><BALAMT>-812.40</BALAMT><DTASOF>20260924</DTASOF></LEDGERBAL>
    </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

const brokerage = `${SGML_HEADER}
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260926<LANGUAGE>ENG
<FI><ORG>fidelity.com<FID>7776</FI></SONRS></SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>1
<INVSTMTRS>
<DTASOF>20260926160000.000[-4:EDT]
<CURDEF>USD
<INVACCTFROM><BROKERID>fidelity.com<ACCTID>X00005555</INVACCTFROM>
<INVPOSLIST>
<POSSTOCK><INVPOS><SECID><UNIQUEID>000000001<UNIQUEIDTYPE>CUSIP</SECID><HELDINACCT>CASH<POSTYPE>LONG<UNITS>10<UNITPRICE>100.00<MKTVAL>1000.00<DTPRICEASOF>20260926</INVPOS></POSSTOCK>
<POSMF><INVPOS><SECID><UNIQUEID>000000002<UNIQUEIDTYPE>CUSIP</SECID><HELDINACCT>CASH<POSTYPE>LONG<UNITS>2.5<UNITPRICE>40<MKTVAL>100<DTPRICEASOF>20260926</INVPOS></POSMF>
</INVPOSLIST>
<INVBAL><AVAILCASH>25.50<MARGINBALANCE>0<SHORTBALANCE>0</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST>
<STOCKINFO><SECINFO><SECID><UNIQUEID>000000001<UNIQUEIDTYPE>CUSIP</SECID><SECNAME>ACME CORP<TICKER>ACME</SECINFO></STOCKINFO>
<MFINFO><SECINFO><SECID><UNIQUEID>000000002<UNIQUEIDTYPE>CUSIP</SECID><SECNAME>SAMPLE INDEX FUND<TICKER>SMPLX</SECINFO></MFINFO>
</SECLIST></SECLISTMSGSRSV1>
</OFX>`;

describe("parseOfxTree", () => {
  it("handles unclosed SGML leaves and decodes entities", () => {
    const tree = parseOfxTree(chaseChecking);
    const names = JSON.stringify(tree);
    expect(names).toContain('"COFFEE & CO"');
  });

  it("rejects non-OFX files", () => {
    expect(() => parseOfxTree("Date,Amount\n")).toThrow(/OFX/);
  });
});

describe("parseOfx", () => {
  it("reads a Chase-style SGML checking statement", () => {
    const { balances, holdings } = parseOfx(chaseChecking, "Chase1234_Activity_20260926.QFX");
    expect(holdings).toBeNull();
    expect(balances).toMatchObject({ institution: "Chase", asOf: "2026-09-26" });
    expect(balances!.accounts).toEqual([
      { label: "000000001234", name: "Checking", mask: "1234", kind: "bank", balance: 12500.25, currency: "USD", asOf: "2026-09-26" },
    ]);
  });

  it("reads an XML file with savings and a credit card", () => {
    const { balances } = parseOfx(wellsFargoXml, "download.qfx");
    expect(balances!.institution).toBe("Wells Fargo");
    expect(balances!.asOf).toBe("2026-09-25");
    expect(balances!.accounts.map((a) => [a.name, a.mask, a.kind, a.balance, a.asOf])).toEqual([
      ["Savings", "5678", "bank", 3000, "2026-09-25"],
      ["Credit card", "4321", "credit", -812.4, "2026-09-24"],
    ]);
  });

  it("reads brokerage positions with tickers from the security list", () => {
    const { balances, holdings } = parseOfx(brokerage, "Fidelity.ofx");
    expect(balances).toBeNull();
    expect(holdings!.institution).toBe("Fidelity");
    expect(holdings!.asOf).toBe("2026-09-26");
    expect(holdings!.accounts[0]).toMatchObject({ mask: "5555", total: 1125.5 });
    expect(holdings!.accounts[0].holdings).toEqual([
      { symbol: "ACME", name: "ACME CORP", type: "stock", quantity: 10, price: 100, marketValue: 1000, costBasis: null },
      { symbol: "SMPLX", name: "SAMPLE INDEX FUND", type: "fund", quantity: 2.5, price: 40, marketValue: 100, costBasis: null },
      { symbol: null, name: "Cash", type: "cash", quantity: null, price: null, marketValue: 25.5, costBasis: null },
    ]);
  });
});
