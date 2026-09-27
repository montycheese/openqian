import type { HoldingType } from "@/lib/db/schema";
import { detectInstitution } from "@/lib/institutions";
import type { Table } from "./read-table";

export type ParsedHolding = {
  symbol: string | null;
  name: string;
  type: HoldingType;
  quantity: number | null;
  price: number | null;
  marketValue: number;
  costBasis: number | null;
};

export type ParsedAccount = {
  /** Account label as it appears in the file, or "" when the file has none. */
  label: string;
  name: string;
  mask: string | null;
  holdings: ParsedHolding[];
  total: number;
};

export type HoldingsImport = {
  institution: string | null;
  /** YYYY-MM-DD the export was taken. */
  asOf: string;
  accounts: ParsedAccount[];
  /** Compares the file's own total row with the sum of parsed positions. */
  checksum: { expected: number; actual: number; ok: boolean } | null;
  warnings: string[];
};

type Column = "account" | "accountName" | "symbol" | "name" | "quantity" | "price" | "value" | "cost" | "type";

const normalize = (h: string) =>
  h
    .toLowerCase()
    .replace(/\(\$\)|\$|%/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Header matchers, tried in order; the first matching column wins. */
const MATCHERS: Record<Column, (h: string) => boolean> = {
  account: (h) => /^account( number| no| num)?$/.test(h),
  accountName: (h) => /^account (name|nickname|description)$/.test(h),
  symbol: (h) => /^(symbol|ticker)\b/.test(h),
  name: (h) => /^(description|name|security|security name|security description|investment|investment name)$/.test(h),
  quantity: (h) => /^(quantity|qty|shares)\b/.test(h),
  price: (h) => /^(last price|price|last|current price|share price|closing price|market price)\b/.test(h) && !/chng|change/.test(h),
  value: (h) => /^(current value|market value|mkt val|value|total value)\b/.test(h) && !/chng|change/.test(h),
  cost: (h) => /^(cost basis total|total cost|cost basis|cost)\b/.test(h) && !/average|avg|per share|adjusted/.test(h),
  // A bare "Type" column is skipped: Fidelity uses it for cash vs. margin, not the security type.
  type: (h) => /^(product type|security type|asset type|asset class|investment type)$/.test(h),
};

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (!s || /^(-|--|n\/?a)$/i.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()$,%+\s-]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function findHeader(rows: Table): { index: number; columns: Partial<Record<Column, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const columns: Partial<Record<Column, number>> = {};
    rows[i].forEach((cell, c) => {
      const h = normalize(cell);
      if (!h) return;
      for (const key of Object.keys(MATCHERS) as Column[]) {
        if (columns[key] === undefined && MATCHERS[key](h)) {
          columns[key] = c;
          break;
        }
      }
    });
    if (columns.symbol !== undefined && (columns.quantity !== undefined || columns.value !== undefined)) {
      return { index: i, columns };
    }
  }
  return null;
}

function findAsOf(rows: Table): string | null {
  for (const row of rows) {
    for (const cell of row) {
      const m = cell.match(/(?:as of|downloaded)[^/]{0,30}?(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return null;
}

const TICKER = /^[A-Z0-9][A-Z0-9.\-/]{0,11}$/;
const CASH_TEXT = /\bcash\b|money market|bank deposit|deposit program|sweep|\bmmf\b|core position/i;

function classify(symbol: string, name: string, typeText: string): { symbol: string | null; type: HoldingType } {
  const cleaned = symbol.replace(/\*+$/, "").trim().toUpperCase();
  const isCash = CASH_TEXT.test(typeText) || CASH_TEXT.test(name) || CASH_TEXT.test(symbol) || /\*\*$/.test(symbol);
  const ticker = TICKER.test(cleaned) ? cleaned : null;
  if (isCash) return { symbol: ticker, type: "cash" };
  const t = typeText.toLowerCase();
  const type: HoldingType = /etf|etp|cef|exchange.traded/.test(t)
    ? "etf"
    : /mutual fund|fund/.test(t)
      ? "fund"
      : /bond|fixed income|treasur|cd\b|certificate/.test(t)
        ? "bond"
        : /crypto/.test(t)
          ? "crypto"
          : /stock|equit|common|adr/.test(t)
            ? "stock"
            : /option/.test(t)
              ? "option"
              : ticker
                ? "stock"
                : "other";
  return { symbol: ticker, type };
}

function splitAccount(label: string): { name: string; mask: string | null } {
  const digits = label.match(/(\d{3,})\D*$/);
  const mask = digits ? digits[1].slice(-4) : null;
  const name = label.replace(/[\s\-–:#.]*[x*.]*\d{3,}\D*$/i, "").trim();
  return { name: name || label, mask };
}

/** Parses a positions/holdings export (CSV or spreadsheet rows) from any brokerage. */
export function parseHoldingsTable(rows: Table, fileName: string): HoldingsImport {
  const header = findHeader(rows);
  if (!header) {
    throw new Error(
      "Couldn't find a positions table in this file. It needs columns like Symbol and Quantity or Market Value.",
    );
  }
  const { index, columns: col } = header;
  const get = (row: string[], c: Column) => {
    const v = col[c] === undefined ? "" : (row[col[c]!] ?? "").trim();
    return /^(-|--|n\/?a)$/i.test(v) ? "" : v;
  };

  const preamble = rows.slice(0, index).flat().join(" ");
  const warnings: string[] = [];
  const groups = new Map<string, ParsedAccount>();
  const totals: number[] = [];
  let institutionText = preamble + " " + fileName;

  for (const row of rows.slice(index + 1)) {
    if (row.every((c) => !c)) continue;
    const first = row.find((c) => c) ?? "";
    const symbolCell = get(row, "symbol");
    const quantity = parseNumber(get(row, "quantity"));
    const price = parseNumber(get(row, "price"));
    let value = parseNumber(get(row, "value"));

    if (/^(account )?totals?\b/i.test(first) || /^(account )?totals?\b/i.test(symbolCell)) {
      if (value !== null) totals.push(value);
      continue;
    }
    if (value === null && quantity !== null && price !== null) value = quantity * price;
    if (value === null) continue; // footers, disclaimers, blank lines

    const name = get(row, "name") || symbolCell;
    if (!name && !symbolCell) continue;
    institutionText += " " + row.join(" ");

    const label = get(row, "account");
    let group = groups.get(label);
    if (!group) {
      const split = label ? splitAccount(label) : { name: "", mask: null };
      group = {
        label,
        name: get(row, "accountName") || split.name,
        mask: split.mask,
        holdings: [],
        total: 0,
      };
      groups.set(label, group);
    }

    const { symbol, type } = classify(symbolCell, name, get(row, "type"));
    const hasQuantity = type !== "cash" && quantity !== null;
    group.holdings.push({
      symbol,
      name: name || symbol || "Unknown",
      type,
      quantity: hasQuantity ? quantity : null,
      price: hasQuantity ? price : null,
      marketValue: value,
      costBasis: parseNumber(get(row, "cost")),
    });
    group.total += value;
  }

  const accounts = [...groups.values()];
  if (accounts.length === 0) throw new Error("No positions found in this file.");

  // Without an account column, look for "account ...1234" in the file's header text.
  if (accounts.length === 1 && !accounts[0].label) {
    const m = preamble.match(/account\b[^0-9]{0,40}?(\d{3,})/i);
    if (m) accounts[0].mask = m[1].slice(-4);
  }

  const actual = round2(accounts.reduce((s, a) => s + a.total, 0));
  let checksum: HoldingsImport["checksum"] = null;
  if (totals.length === 1) {
    const expected = round2(totals[0]);
    checksum = { expected, actual, ok: Math.abs(expected - actual) <= Math.max(0.05, Math.abs(expected) * 1e-6) };
    if (!checksum.ok) warnings.push("The positions don't add up to the file's total. Some rows may not have been read.");
  }

  const asOf = findAsOf(rows) ?? new Date().toISOString().slice(0, 10);
  if (!findAsOf(rows)) warnings.push("No export date found in the file; using today's date.");

  return { institution: detectInstitution(institutionText), asOf, accounts, checksum, warnings };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
