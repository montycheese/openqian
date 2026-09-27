import { localDate } from "@/lib/dates";
import type { HoldingType } from "@/lib/db/schema";
import { detectInstitution } from "@/lib/institutions";
import type { HoldingsImport, ParsedAccount, ParsedHolding } from "./parse-holdings";

/** An OFX/QFX element: leaf elements carry a value, aggregates carry children. */
type Node = { name: string; value: string | null; children: Node[] };

export type ParsedBalance = {
  label: string;
  name: string;
  mask: string | null;
  kind: "bank" | "credit";
  /** Balance as the institution reports it; credit-card debt is negative. */
  balance: number;
  currency: string;
  asOf: string;
};

export type BalancesImport = {
  institution: string | null;
  asOf: string;
  accounts: ParsedBalance[];
  warnings: string[];
};

export type OfxImport = { balances: BalancesImport | null; holdings: HoldingsImport | null };

/**
 * Parses OFX 1.x (SGML, where leaf elements have no closing tag) and OFX 2.x
 * (XML). Quicken "Web Connect" .qfx downloads are OFX with an Intuit header.
 */
export function parseOfxTree(text: string): Node {
  const start = text.search(/<OFX>/i);
  if (start < 0) throw new Error("This doesn't look like an OFX/QFX file.");
  const body = text.slice(start);
  const tokens = body.match(/<[^>]+>|[^<]+/g) ?? [];

  const root: Node = { name: "ROOT", value: null, children: [] };
  const stack: Node[] = [root];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("<")) continue; // stray text between aggregates
    if (token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim().toUpperCase();
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at; // also closes SGML leaves left open
      continue;
    }
    const name = token.slice(1, -1).trim().replace(/\/$/, "").toUpperCase();
    const node: Node = { name, value: null, children: [] };
    stack[stack.length - 1].children.push(node);
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("<") && next.trim()) {
      node.value = next.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      i++;
      if (tokens[i + 1]?.toUpperCase() === `</${name}>`) i++; // XML-style closing tag
    } else if (!token.endsWith("/>")) {
      stack.push(node);
    }
  }
  const ofx = root.children.find((n) => n.name === "OFX");
  if (!ofx) throw new Error("This doesn't look like an OFX/QFX file.");
  return ofx;
}

function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

const find = (node: Node, name: string) => {
  for (const n of walk(node)) if (n.name === name) return n;
  return undefined;
};
const findAll = (node: Node, name: string) => [...walk(node)].filter((n) => n.name === name);
const text = (node: Node | undefined, name: string) => (node ? (find(node, name)?.value ?? null) : null);

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(/,/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** OFX dates look like 20260926120000.000[-5:EST]. */
function ofxDate(value: string | null): string | null {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const mask = (acctId: string | null) => {
  const digits = acctId?.replace(/\D/g, "") ?? "";
  return digits.length >= 3 ? digits.slice(-4) : null;
};

const ACCOUNT_TYPE_NAMES: Record<string, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  MONEYMRKT: "Money market",
  CREDITLINE: "Line of credit",
  CD: "CD",
};

const POSITION_TYPES: Record<string, HoldingType> = {
  POSSTOCK: "stock",
  POSMF: "fund",
  POSDEBT: "bond",
  POSOPT: "option",
  POSOTHER: "other",
};

export function parseOfx(fileText: string, fileName: string): OfxImport {
  const ofx = parseOfxTree(fileText);
  const org = text(find(ofx, "FI"), "ORG");
  const institution = detectInstitution(`${org ?? ""} ${fileName}`) ?? org;
  const today = localDate();
  const warnings: string[] = [];

  // Bank and credit-card statements → balances
  const balances: ParsedBalance[] = [];
  for (const stmt of [...findAll(ofx, "STMTRS"), ...findAll(ofx, "CCSTMTRS")]) {
    const isCredit = stmt.name === "CCSTMTRS";
    const from = find(stmt, isCredit ? "CCACCTFROM" : "BANKACCTFROM");
    const ledger = find(stmt, "LEDGERBAL");
    const balance = num(text(ledger, "BALAMT"));
    if (balance === null) {
      warnings.push("A statement in this file has no balance and was skipped.");
      continue;
    }
    const acctId = text(from, "ACCTID");
    const typeName = isCredit ? "Credit card" : (ACCOUNT_TYPE_NAMES[text(from, "ACCTTYPE") ?? ""] ?? "Account");
    balances.push({
      label: acctId ?? "",
      name: typeName,
      mask: mask(acctId),
      kind: isCredit ? "credit" : "bank",
      balance,
      currency: (text(stmt, "CURDEF") ?? "USD").toUpperCase(),
      asOf: ofxDate(text(ledger, "DTASOF")) ?? ofxDate(text(find(ofx, "SONRS"), "DTSERVER")) ?? today,
    });
  }

  // Investment statements → positions
  const securities = new Map<string, { ticker: string | null; name: string | null }>();
  for (const info of findAll(ofx, "SECINFO")) {
    const id = text(info, "UNIQUEID");
    if (id) securities.set(id, { ticker: text(info, "TICKER"), name: text(info, "SECNAME") });
  }
  const investmentAccounts: ParsedAccount[] = [];
  let investmentAsOf: string | null = null;
  for (const stmt of findAll(ofx, "INVSTMTRS")) {
    const acctId = text(find(stmt, "INVACCTFROM"), "ACCTID");
    investmentAsOf ??= ofxDate(text(stmt, "DTASOF"));
    const positions: ParsedHolding[] = [];
    for (const pos of find(stmt, "INVPOSLIST")?.children ?? []) {
      const inv = find(pos, "INVPOS");
      const value = num(text(inv, "MKTVAL"));
      if (!inv || value === null) continue;
      const id = text(inv, "UNIQUEID");
      const sec = (id && securities.get(id)) || { ticker: null, name: null };
      positions.push({
        symbol: sec.ticker?.toUpperCase() ?? null,
        name: sec.name ?? sec.ticker ?? id ?? "Unknown security",
        type: POSITION_TYPES[pos.name] ?? "other",
        quantity: num(text(inv, "UNITS")),
        price: num(text(inv, "UNITPRICE")),
        marketValue: value,
        costBasis: null,
      });
    }
    const cash = num(text(find(stmt, "INVBAL"), "AVAILCASH"));
    if (cash) {
      positions.push({ symbol: null, name: "Cash", type: "cash", quantity: null, price: null, marketValue: cash, costBasis: null });
    }
    if (positions.length === 0) continue;
    investmentAccounts.push({
      label: acctId ?? "",
      name: "Brokerage",
      mask: mask(acctId),
      holdings: positions,
      total: positions.reduce((s, h) => s + h.marketValue, 0),
    });
  }

  if (balances.length === 0 && investmentAccounts.length === 0) {
    throw new Error("No balances or positions found in this OFX file.");
  }

  return {
    balances:
      balances.length > 0
        ? { institution, asOf: balances.map((b) => b.asOf).sort().at(-1)!, accounts: balances, warnings }
        : null,
    holdings:
      investmentAccounts.length > 0
        ? { institution, asOf: investmentAsOf ?? today, accounts: investmentAccounts, checksum: null, warnings: [] }
        : null,
  };
}
