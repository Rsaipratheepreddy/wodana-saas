import { ledgerDecimal } from "../ledger/ledger";

/** Exact money for reports: decimal text with 4 places, added as BigInt units of 10^-4 (never floats). */

export const ZERO = "0.0000";

export function units(value: string | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  return ledgerDecimal.units4(normalise(value));
}

/** "105000" → "105000.0000"; Postgres numerics with more than 4 places are refused by units4, so round them first. */
function normalise(value: string) {
  const match = /^([+-]?\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || !match[2] || match[2].length <= 4) return value.trim();
  // Half away from zero at the 5th decimal (report inputs are already 4-place numerics; this only guards).
  const negative = match[1].startsWith("-");
  const whole = match[1].replace(/^[+-]/, "");
  let scaled = BigInt(whole + match[2].slice(0, 4));
  if (Number(match[2][4]) >= 5) scaled += 1n;
  return ledgerDecimal.format4(negative ? -scaled : scaled);
}

export const money = (value: bigint) => ledgerDecimal.format4(value);
export const add = (...values: Array<string | null | undefined>) => money(values.reduce<bigint>((sum, value) => sum + units(value), 0n));
export const sub = (left: string | null | undefined, right: string | null | undefined) => money(units(left) - units(right));
export const neg = (value: string | null | undefined) => money(-units(value));
export const isZero = (value: string | null | undefined) => units(value) === 0n;

// ---------------------------------------------------------------------------------------------------------------
// Days.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The first day of the financial year `day` falls in, for a year starting in `startMonth` (1–12). */
export function fiscalYearStart(day: string, startMonth: number) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const month2 = String(startMonth).padStart(2, "0");
  return month >= startMonth ? `${year}-${month2}-01` : `${year - 1}-${month2}-01`;
}

/** The calendar quarter `day` falls in. */
export function quarterOf(day: string) {
  const year = Number(day.slice(0, 4));
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  const start = `${year}-${String(quarter * 3 + 1).padStart(2, "0")}-01`;
  const next = quarter === 3 ? `${year + 1}-01-01` : `${year}-${String(quarter * 3 + 4).padStart(2, "0")}-01`;
  return { from: start, to: addDays(next, -1) };
}

// ---------------------------------------------------------------------------------------------------------------
// CSV.

/** One CSV document; cells that a spreadsheet would read as a formula are prefixed with a quote. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>) {
  const quote = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    const safe = /^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}
