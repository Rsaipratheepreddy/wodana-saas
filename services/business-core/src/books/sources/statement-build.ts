import { Dec } from "../../catalog-core/decimal";
import { addColumns, money, profitAndLossTotals, sumRows, zeros } from "./statement-math";
import { PNL_SECTIONS, type CashFlowStatement, type FinancialStatementSection, type Money, type PnlSectionKey, type ProfitAndLossStatement, type StatementColumn,
  type StatementHeader, type StatementRow } from "./statement-types";

/**
 * Builds the shared statement shapes from sections a provider adapter read. Section labels are English (the web
 * translates them with t()); account names stay as the accounting system has them.
 */

export const PNL_SECTION_LABELS: Record<PnlSectionKey, string> = {
  revenue: "Revenue", cost_of_sales: "Cost of sales", operating_expenses: "Operating expenses", other_income: "Other income", other_expenses: "Other expenses",
};

/** The cash flow sections both accounting systems report (indirect method). */
export const ACTIVITY_SECTIONS = ["operating_activities", "investing_activities", "financing_activities"] as const;
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];
export const ACTIVITY_LABELS: Record<ActivitySection, string> = {
  operating_activities: "Operating activities", investing_activities: "Investing activities", financing_activities: "Financing activities",
};

export type ReadSection = { key: string; rows: StatementRow[]; total: Money[] | null };

type Meta = Omit<StatementHeader, "columns" | "notes" | "basis"> & { basis: StatementHeader["basis"] };

/** A section's total: the provider's own when it gave one, else the sum of its rows. */
const sectionTotal = (section: ReadSection | undefined, count: number) => section?.total ?? (section ? sumRows(section.rows, count) : zeros(count));

/** The P&L in the fixed section order; a section the provider left out is empty. A provider net profit that differs is noted. */
export function buildProfitAndLoss(meta: Meta, columns: StatementColumn[], read: ReadSection[], providerNet: Money[] | null, notes: string[] = []): ProfitAndLossStatement {
  const count = columns.length;
  const sections: FinancialStatementSection[] = PNL_SECTIONS.map((key) => {
    const found = read.filter((section) => section.key === key);
    const rows = found.flatMap((section) => section.rows);
    const total = found.reduce<Money[]>((sum, section) => addColumns(sum, sectionTotal(section, count)), zeros(count));
    return { key, label: PNL_SECTION_LABELS[key], rows, total };
  });
  const totals = profitAndLossTotals(sections, count);
  const all = [...notes];
  if (providerNet && providerNet.some((value, index) => Dec.of(value).cmp(totals.netProfit[index]) !== 0))
    all.push("The accounting system's net profit differs from the sum of its sections.");
  return { ...meta, statement: "profit_and_loss", columns, notes: all, sections, totals };
}

/**
 * The cash flow as the accounting system reports it: operating, investing and financing activities, the net change,
 * and cash at the start and end of every month. Missing opening cash is zero (noted); missing closing is opening + net.
 */
export function buildCashFlow(meta: Meta, columns: StatementColumn[], read: ReadSection[], figures: { net: Money[] | null; opening: Money[] | null; closing: Money[] | null },
  notes: string[] = []): CashFlowStatement {
  const count = columns.length;
  const sections: FinancialStatementSection[] = ACTIVITY_SECTIONS.map((key) => {
    const found = read.filter((section) => section.key === key);
    return { key, label: ACTIVITY_LABELS[key], rows: found.flatMap((section) => section.rows),
      total: found.reduce<Money[]>((sum, section) => addColumns(sum, sectionTotal(section, count)), zeros(count)) };
  });
  const netCashFlow = figures.net ?? sections.reduce<Money[]>((sum, section) => addColumns(sum, section.total), zeros(count));
  const all = [...notes];
  if (!figures.opening) all.push("The accounting system gave no opening cash.");
  const opening = figures.opening ?? zeros(count);
  const closing = figures.closing ?? opening.map((value, index) => money(Dec.of(value).add(netCashFlow[index])));
  return { ...meta, statement: "cash_flow", columns, notes: all, sections, netCashFlow, opening, closing, accounts: [], forecast: null };
}
