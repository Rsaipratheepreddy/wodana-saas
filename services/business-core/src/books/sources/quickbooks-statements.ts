import { buildCashFlow, buildProfitAndLoss, type ActivitySection, type ReadSection } from "./statement-build";
import { amountOf, labelKey, money, sumRows } from "./statement-math";
import type { CashFlowStatement, Money, PnlSectionKey, ProfitAndLossStatement, StatementColumn, StatementHeader, StatementRow } from "./statement-types";

/**
 * QuickBooks Online Reports API (ProfitAndLoss, CashFlow) mapped into the shared statement shapes. A report is a tree
 * of rows: sections (Header, Rows, Summary) and data rows (ColData), with one money column per month or a total.
 * Amounts are decimal text (the integration service never turns them into floats).
 */

type ColData = { value?: unknown; id?: unknown };
export type QuickBooksRow = { type?: string; group?: string; Header?: { ColData?: ColData[] }; Rows?: { Row?: QuickBooksRow[] }; Summary?: { ColData?: ColData[] }; ColData?: ColData[] };
type Column = { ColTitle?: string; ColType?: string; MetaData?: Array<{ Name?: string; Value?: string }> };
export type QuickBooksReport = { Header?: { Currency?: string; ReportName?: string }; Columns?: { Column?: Column[] }; Rows?: { Row?: QuickBooksRow[] } };

const PNL_GROUPS: Record<string, PnlSectionKey> = { Income: "revenue", COGS: "cost_of_sales", Expenses: "operating_expenses", OtherIncome: "other_income", OtherExpenses: "other_expenses" };
const ACTIVITY_GROUPS: Record<string, ActivitySection> = { OperatingActivities: "operating_activities", InvestingActivities: "investing_activities", FinancingActivities: "financing_activities" };

type Meta = Omit<StatementHeader, "columns" | "notes" | "source"> ;

const meta = (value: Meta) => ({ ...value, source: "quickbooks" as const });
const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const metaValue = (column: Column, name: string) => column.MetaData?.find((item) => item.Name === name)?.Value ?? null;

/**
 * Which ColData index holds each wanted column. A total report has one money column. A report by month carries each
 * month's start date in the column's metadata; without it the month columns are taken in order (the trailing total
 * column left out). A month the report doesn't have reads as zero (-1).
 */
export function columnIndexes(report: QuickBooksReport, wanted: readonly StatementColumn[]): number[] {
  const columns = report.Columns?.Column ?? [];
  const moneyAt = columns.map((column, index) => ({ column, index })).filter(({ column, index }) => index > 0 && (column.ColType ?? "Money") === "Money");
  if (!moneyAt.length) throw new TypeError("The report has no amount columns.");
  if (wanted.length === 1 && wanted[0].role !== "month") {
    const total = moneyAt.find(({ column }) => metaValue(column, "ColKey") === "total" || /^total$/i.test(column.ColTitle ?? ""));
    return [(total ?? moneyAt[moneyAt.length - 1]).index];
  }
  const dated = moneyAt.filter(({ column }) => metaValue(column, "StartDate"));
  if (dated.length) return wanted.map((item) => dated.find(({ column }) => (metaValue(column, "StartDate") ?? "").slice(0, 7) === item.key.slice(0, 7))?.index ?? -1);
  const months = moneyAt.filter(({ column }) => !(metaValue(column, "ColKey") === "total" || /^total$/i.test(column.ColTitle ?? "")));
  return wanted.map((_, position) => months[position]?.index ?? -1);
}

const cells = (data: ColData[] | undefined, indexes: number[]): Money[] => indexes.map((index) => (index < 0 ? money(0) : amountOf(data?.[index]?.value)));
const isSection = (row: QuickBooksRow) => Boolean(row.Rows || row.Header || row.Summary || row.type === "Section");

/** One report row as a statement row: a section keeps its children and its summary, a data row its cells. */
export function quickBooksRow(row: QuickBooksRow, indexes: number[]): StatementRow {
  if (isSection(row)) {
    const header = row.Header?.ColData?.[0];
    const label = text(header?.value) || text(row.Summary?.ColData?.[0]?.value).replace(/^Total\s+/i, "") || row.group || "";
    const id = text(header?.id);
    const children = (row.Rows?.Row ?? []).map((child) => quickBooksRow(child, indexes));
    const amounts = row.Summary?.ColData ? cells(row.Summary.ColData, indexes) : sumRows(children, indexes.length);
    return { key: id ? `account:${id}` : `group:${labelKey(label)}`, label, amounts, ...(children.length ? { rows: children } : {}) };
  }
  const first = row.ColData?.[0];
  const label = text(first?.value);
  const id = text(first?.id);
  return { key: id ? `account:${id}` : `row:${labelKey(label)}`, label, amounts: cells(row.ColData, indexes) };
}

/** The rows of a top-level group (its summary is the section's total). */
function section(row: QuickBooksRow, key: string, indexes: number[]): ReadSection {
  return { key, rows: (row.Rows?.Row ?? []).map((child) => quickBooksRow(child, indexes)), total: row.Summary?.ColData ? cells(row.Summary.ColData, indexes) : null };
}

export function mapQuickBooksProfitAndLoss(report: QuickBooksReport, header: Meta, columns: StatementColumn[]): ProfitAndLossStatement {
  const indexes = columnIndexes(report, columns);
  const read: ReadSection[] = [];
  let net: Money[] | null = null;
  for (const row of report.Rows?.Row ?? []) {
    const key = row.group ? PNL_GROUPS[row.group] : undefined;
    if (key) read.push(section(row, key, indexes));
    else if (row.group === "NetIncome" && row.Summary?.ColData) net = cells(row.Summary.ColData, indexes);
  }
  return buildProfitAndLoss(meta(header), columns, read, net);
}

export function mapQuickBooksCashFlow(report: QuickBooksReport, header: Meta, columns: StatementColumn[]): CashFlowStatement {
  const indexes = columnIndexes(report, columns);
  const read: ReadSection[] = [];
  const figures: { net: Money[] | null; opening: Money[] | null; closing: Money[] | null } = { net: null, opening: null, closing: null };
  for (const row of report.Rows?.Row ?? []) {
    const activity = row.group ? ACTIVITY_GROUPS[row.group] : undefined;
    if (activity) { read.push(section(row, activity, indexes)); continue; }
    const summary = row.Summary?.ColData ?? row.ColData;
    if (!summary) continue;
    if (row.group === "CashIncrease") figures.net = cells(summary, indexes);
    else if (row.group === "BeginningCash") figures.opening = cells(summary, indexes);
    else if (row.group === "EndingCash") figures.closing = cells(summary, indexes);
  }
  return buildCashFlow(meta(header), columns, read, figures);
}
