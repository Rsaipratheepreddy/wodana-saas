import { ledgerDecimal } from "../ledger/ledger";

/**
 * Opening balances from a trial balance file (CSV): one row per account with its code and a debit or a credit.
 * The pure part (no database): reading the file, the columns, the amounts and the totals, with every problem named
 * by its row number in the file (the header is row 1).
 */

export type OpeningRow = { row: number; code: string; debit: string; credit: string; description: string };
export type RowError = { row: number | null; message: string };
export type ParsedOpening = { rows: OpeningRow[]; errors: RowError[]; debit: string; credit: string };

export const OPENING_MAX_BYTES = 1_000_000;
export const OPENING_MAX_ROWS = 2_000;

/** CSV rows (quotes, doubled quotes, CRLF, a BOM); the delimiter is a comma, a semicolon or a tab, whichever the first line uses. */
export function parseCsv(input: string): string[][] {
  const content = input.replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const best = [",", ";", "\t"].map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 })).sort((left, right) => right.count - left.count)[0];
  const delimiter = best.count > 0 ? best.candidate : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === "\"") {
        if (content[index + 1] === "\"") { cell += "\""; index += 1; } else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === "\"" && cell.trim() === "") { quoted = true; cell = ""; continue; }
    if (character === delimiter) { row.push(cell); cell = ""; continue; }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += character;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((cells) => cells.map((value) => value.trim()));
}

const NUMBER = /^\(?-?[\d\s,.]*\d[\d\s,.]*\)?$/;

/**
 * An amount as a trial balance writes it: "1,234.50", "1 234.50", "(500)" for a negative, blank for nothing.
 * Returns units of 10^-4, or an error message.
 */
export function readAmount(raw: string): { units: bigint } | { error: string } {
  const value = raw.trim();
  if (!value || value === "-") return { units: 0n };
  if (!NUMBER.test(value)) return { error: `"${value}" is not an amount` };
  const negative = value.startsWith("(") || value.includes("-");
  const digits = value.replace(/[()\s,-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return { error: `"${value}" is not an amount` };
  const [whole, fraction = ""] = digits.split(".");
  if (fraction.length > 4) return { error: `${value} has more than four decimals` };
  const units = ledgerDecimal.units4(`${whole}.${fraction || "0"}`);
  return { units: negative ? -units : units };
}

type Columns = { code: number; debit: number; credit: number; name: number | null; header: boolean };

/** Which columns hold the code, debit and credit: named by a header row, else code, (name,) debit, credit by position. */
export function findColumns(rows: string[][]): Columns | null {
  const first = rows[0] ?? [];
  const find = (pattern: RegExp) => first.findIndex((cell) => pattern.test(cell.toLowerCase()));
  const debit = find(/^(debit|dr\.?|debits)$|debit/);
  const credit = find(/^(credit|cr\.?|credits)$|credit/);
  if (debit >= 0 && credit >= 0) {
    let code = find(/code|^account( no\.?| number)?$|^no\.?$|^number$/);
    if (code < 0) code = first.findIndex((_cell, index) => index !== debit && index !== credit);
    const name = first.findIndex((cell, index) => index !== code && index !== debit && index !== credit && /name|account|description/.test(cell.toLowerCase()));
    return code < 0 ? null : { code, debit, credit, name: name < 0 ? null : name, header: true };
  }
  const width = Math.max(...rows.slice(0, 5).map((row) => row.length), 0);
  if (width >= 4) return { code: 0, name: 1, debit: 2, credit: 3, header: false };
  if (width === 3) return { code: 0, name: null, debit: 1, credit: 2, header: false };
  return null;
}

/**
 * The rows of a trial balance: each a code with a debit or a credit (a negative amount moves to the other side; a
 * row with nothing is skipped). Problems carry their row number. The totals are what the rows add up to; the
 * caller checks the codes against the chart.
 */
export function parseOpening(csv: string): ParsedOpening {
  const errors: RowError[] = [];
  const empty = { rows: [], debit: "0.0000", credit: "0.0000" };
  if (csv.length > OPENING_MAX_BYTES) return { ...empty, errors: [{ row: null, message: "The file is larger than 1 MB." }] };
  const all = parseCsv(csv);
  const columns = findColumns(all.filter((row) => row.some(Boolean)));
  if (!columns) return { ...empty, errors: [{ row: null, message: "The file needs columns for the account code, debit and credit." }] };
  const rows: OpeningRow[] = [];
  const seen = new Map<string, number>();
  let debitTotal = 0n, creditTotal = 0n;
  let headerSkipped = !columns.header;
  all.forEach((cells, index) => {
    const rowNumber = index + 1;
    if (!cells.some(Boolean)) return;
    if (!headerSkipped) { headerSkipped = true; return; }
    if (rows.length >= OPENING_MAX_ROWS) {
      if (rows.length === OPENING_MAX_ROWS && !errors.some((error) => error.row === null)) errors.push({ row: null, message: `A file has at most ${OPENING_MAX_ROWS} rows.` });
      return;
    }
    const code = (cells[columns.code] ?? "").trim();
    const debit = readAmount(cells[columns.debit] ?? "");
    const credit = readAmount(cells[columns.credit] ?? "");
    if ("error" in debit || "error" in credit) {
      errors.push({ row: rowNumber, message: "error" in debit ? debit.error : (credit as { error: string }).error });
      return;
    }
    // A row with nothing is skipped; a negative debit is a credit and the other way round.
    if (!debit.units && !credit.units) return;
    if (debit.units && credit.units) { errors.push({ row: rowNumber, message: "Enter a debit or a credit, not both" }); return; }
    const net = debit.units - credit.units;
    if (!code) { errors.push({ row: rowNumber, message: "The account code is missing" }); return; }
    const earlier = seen.get(code.toLowerCase());
    if (earlier) { errors.push({ row: rowNumber, message: `Account ${code} is already on row ${earlier}` }); return; }
    seen.set(code.toLowerCase(), rowNumber);
    const description = columns.name === null ? "" : (cells[columns.name] ?? "").trim().slice(0, 500);
    if (net > 0n) debitTotal += net; else creditTotal -= net;
    rows.push({ row: rowNumber, code, debit: ledgerDecimal.format4(net > 0n ? net : 0n), credit: ledgerDecimal.format4(net < 0n ? -net : 0n), description });
  });
  if (!rows.length && !errors.length) errors.push({ row: null, message: "The file has no balances." });
  return { rows, errors, debit: ledgerDecimal.format4(debitTotal), credit: ledgerDecimal.format4(creditTotal) };
}
