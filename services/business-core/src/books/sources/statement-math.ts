import { Dec } from "../../catalog-core/decimal";
import type { FinancialStatementSection, IsoDay, Money, PnlSectionKey, ProfitAndLossTotals, StatementColumn, StatementRow } from "./statement-types";

/**
 * Exact arithmetic for statements read from an accounting system: money as 4-place decimal text, totals per column,
 * the P&L's derived lines and the calendar months a period touches. Never a float.
 */

const AMOUNT = /^-?\d+(\.\d+)?$/;

export const money = (value: Dec | string | number) => Dec.of(value).toFixed(4);
export const zeros = (count: number): Money[] => Array.from({ length: count }, () => money(0));

/** A provider's amount text ("1,234.50", "-12", "") as exact decimal text; blank is zero, anything else is refused. */
export function amountOf(value: unknown): Money {
  if (value === null || value === undefined) return money(0);
  const text = String(value).trim().replace(/,/g, "");
  if (text === "") return money(0);
  if (!AMOUNT.test(text)) throw new TypeError("The report holds an amount that isn't a number.");
  return money(text);
}

export const addColumns = (a: readonly Money[], b: readonly Money[]): Money[] => a.map((value, index) => money(Dec.of(value).add(b[index] ?? "0")));
export const subColumns = (a: readonly Money[], b: readonly Money[]): Money[] => a.map((value, index) => money(Dec.of(value).sub(b[index] ?? "0")));
export const sumRows = (rows: readonly StatementRow[], count: number): Money[] => rows.reduce<Money[]>((sum, row) => addColumns(sum, row.amounts), zeros(count));

/** part ÷ base × 100 to one place (half away from zero); null when the base is zero. */
export function percentOf(part: Money, base: Money): string | null {
  const whole = Dec.of(base);
  return whole.isZero() ? null : Dec.of(part).mul(100).div(whole).round(1).toFixed(1);
}

/** The P&L's derived lines per column from its sections (each section's total is positive as the provider reports it). */
export function profitAndLossTotals(sections: readonly FinancialStatementSection[], count: number): ProfitAndLossTotals {
  const total = (key: PnlSectionKey) => sections.find((section) => section.key === key)?.total ?? zeros(count);
  const revenue = total("revenue"), costOfSales = total("cost_of_sales"), operatingExpenses = total("operating_expenses");
  const otherIncome = total("other_income"), otherExpenses = total("other_expenses");
  const grossProfit = subColumns(revenue, costOfSales);
  const operatingProfit = subColumns(grossProfit, operatingExpenses);
  const netProfit = subColumns(addColumns(operatingProfit, otherIncome), otherExpenses);
  return {
    revenue, costOfSales, grossProfit, grossMarginPercent: grossProfit.map((value, index) => percentOf(value, revenue[index])),
    operatingExpenses, operatingProfit, otherIncome, otherExpenses, netProfit,
    netMarginPercent: netProfit.map((value, index) => percentOf(value, revenue[index])),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Every calendar month the period touches, each clipped to the period (one "month" column each). */
export function monthColumns(from: IsoDay, to: IsoDay): StatementColumn[] {
  const columns: StatementColumn[] = [];
  let [year, month] = from.split("-").map(Number);
  for (let guard = 0; guard < 600; guard += 1) {
    const key = `${year}-${pad(month)}`;
    const start = `${key}-01`, end = `${key}-${pad(lastDay(year, month))}`;
    if (start > to) break;
    columns.push({ key, from: start < from ? from : start, to: end > to ? to : end, role: "month" });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return columns;
}

/** A stable key for a row without an account id: its label, lower case, words joined by underscores. */
export const labelKey = (label: string) => label.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "row";

/**
 * Rows read one column at a time (one report per month) merged into one row per key with an amount for every column;
 * a row missing from a month is zero there. Order follows the first month a row appears in.
 */
export function mergeColumns(perColumn: ReadonlyArray<readonly StatementRow[]>): StatementRow[] {
  const count = perColumn.length;
  const merge = (lists: ReadonlyArray<{ column: number; rows: readonly StatementRow[] }>): StatementRow[] => {
    const order: string[] = [];
    const found = new Map<string, { row: StatementRow; amounts: Money[]; children: Array<{ column: number; rows: readonly StatementRow[] }> }>();
    for (const { column, rows } of lists) for (const row of rows) {
      let entry = found.get(row.key);
      if (!entry) { entry = { row, amounts: zeros(count), children: [] }; found.set(row.key, entry); order.push(row.key); }
      entry.amounts[column] = money(Dec.of(entry.amounts[column]).add(row.amounts[0] ?? "0"));
      if (row.rows?.length) entry.children.push({ column, rows: row.rows });
    }
    return order.map((key) => {
      const { row, amounts, children } = found.get(key)!;
      const { rows: _rows, ...rest } = row;
      return children.length ? { ...rest, amounts, rows: merge(children) } : { ...rest, amounts };
    });
  };
  return merge(perColumn.map((rows, column) => ({ column, rows })));
}
