import ExcelJS from "exceljs";
import Papa from "papaparse";

export type Table = string[][];

export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx"] as const;

/** Reads a CSV or Excel (.xlsx) file into rows of trimmed strings. */
export async function readTable(fileName: string, bytes: ArrayBuffer): Promise<Table> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (ext === ".csv") {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    const { data } = Papa.parse<string[]>(text, { skipEmptyLines: false });
    return data.map((row) => row.map((cell) => (cell ?? "").trim()));
  }
  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: Table = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
      rows[rowNumber - 1] = cells;
    });
    return Array.from(rows, (r) => r ?? []);
  }
  throw new Error(`Unsupported file type. Use ${SUPPORTED_EXTENSIONS.join(" or ")}.`);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
    if ("text" in value) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}
