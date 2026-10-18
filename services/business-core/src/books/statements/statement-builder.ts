import { add, money, sub, units, ZERO } from "../reports/report-math";
import {
  CASH_IN_ROWS, CASH_OUT_ROWS, PNL_COST_CATEGORIES, PNL_REVENUE_CATEGORIES, PNL_SECTIONS,
  type CashAccountBalance, type CashFlowForecast, type CashFlowStatement, type FinancialStatementSection, type Money, type PnlSectionKey,
  type ProfitAndLossStatement, type StatementColumn, type StatementHeader, type StatementRow,
} from "./statement-contract";

/**
 * Builds statements from classified facts, exactly (decimal text added as BigInt units of 10^-4, never floats).
 * Sources only classify: which section, category and account each amount belongs to; the layout, totals, margins
 * and comparisons are worked out here once for every source.
 */

/** The facts a statement may carry (English text, translated where shown). */
export const NOTE_CASH_BASIS = "Cash basis: client payments, supplier payments and petty cash, net of tax";
export const NOTE_NO_RATE = "Some amounts have no exchange rate and are left out";
export const NOTE_UNCOSTED = "Some project costs have no rate yet and are left out";
export const NOTE_OPERATIONAL = "From payments, invoices and bills recorded in Wodana";
export const NOTE_OPERATIONAL_OPENING = "Opening cash is what Wodana recorded before the period";

/** part / base × 100 to one decimal, half away from zero; null when the base is zero. */
export function percent(part: Money, base: Money): string | null {
  const b = units(base);
  if (b === 0n) return null;
  const p = units(part);
  const magnitude = b < 0n ? -b : b;
  const tenths = (p * 1000n * 2n + (p < 0n ? -magnitude : magnitude)) / (2n * magnitude);
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  return `${negative ? "-" : ""}${abs / 10n}.${abs % 10n}`;
}

const zeros = (count: number) => Array.from({ length: count }, () => ZERO);
const isZeroRow = (amounts: readonly Money[]) => amounts.every((value) => units(value) === 0n);
const addInto = (target: Money[], column: number, amount: Money) => { target[column] = add(target[column], amount); };

// ---------------------------------------------------------------------------------------------------------------
// Profit and loss.

/** One amount of a P&L: income credit-positive, expenses debit-positive, so every amount adds to its section. */
export type PnlFact = {
  column: number;
  section: PnlSectionKey;
  /** Revenue and cost of sales: a category of PNL_REVENUE_CATEGORIES / PNL_COST_CATEGORIES. Operating expenses: the account group (parent account), if any. */
  category?: string | null;
  categoryLabel?: string | null;
  /** The leaf: an account (accountId/code) or a named line. */
  key: string;
  label: string;
  code?: string | null;
  accountId?: string | null;
  href?: string | null;
  amount: Money;
};

export const SECTION_LABELS: Record<PnlSectionKey, string> = {
  revenue: "Revenue", cost_of_sales: "Cost of sales", operating_expenses: "Operating expenses", other_income: "Other income", other_expenses: "Other expenses",
};
export const CATEGORY_LABELS: Record<string, string> = {
  design_fees: "Design fees", production: "Production and fit-out", variations: "Variations", other_revenue: "Other revenue",
  materials: "Materials", subcontract_labour: "Subcontract and labour", factory: "Factory", other_costs: "Other costs",
  client_payments: "Client payments", client_advances: "Client advances", other_receipts: "Other receipts",
  supplier_payments: "Supplier payments", labour: "Payroll and labour", expenses: "Expenses", tax: "Tax", other_payments: "Other payments",
};

const ORDERED_CATEGORIES: Partial<Record<PnlSectionKey, readonly string[]>> = { revenue: PNL_REVENUE_CATEGORIES, cost_of_sales: PNL_COST_CATEGORIES };

const byCode = (left: StatementRow, right: StatementRow) =>
  (left.code ?? "￿").localeCompare(right.code ?? "￿") || left.label.localeCompare(right.label) || left.key.localeCompare(right.key);

/** A section's rows from its facts: categories (fixed order, or account groups by code) holding their leaves, then loose leaves. */
function sectionRows(section: PnlSectionKey, facts: readonly PnlFact[], columns: number): StatementRow[] {
  const groups = new Map<string, { row: StatementRow; leaves: Map<string, StatementRow> }>();
  const loose = new Map<string, StatementRow>();
  for (const fact of facts) {
    const leafOf = (into: Map<string, StatementRow>) => {
      let leaf = into.get(fact.key);
      if (!leaf) {
        leaf = { key: fact.key, label: fact.label, code: fact.code ?? null, accountId: fact.accountId ?? null, href: fact.href ?? null, amounts: zeros(columns) };
        into.set(fact.key, leaf);
      }
      addInto(leaf.amounts, fact.column, fact.amount);
    };
    if (!fact.category) { leafOf(loose); continue; }
    let group = groups.get(fact.category);
    if (!group) {
      group = { row: { key: fact.category, label: fact.categoryLabel ?? CATEGORY_LABELS[fact.category] ?? fact.category, amounts: zeros(columns) }, leaves: new Map() };
      groups.set(fact.category, group);
    }
    addInto(group.row.amounts, fact.column, fact.amount);
    // A fact keyed by its category is the category's own amount (a source without accounts): no leaf under it.
    if (fact.key !== fact.category) leafOf(group.leaves);
  }
  const order = ORDERED_CATEGORIES[section];
  const categories = [...groups.values()]
    .map(({ row, leaves }) => ({ ...row, rows: [...leaves.values()].filter((leaf) => !isZeroRow(leaf.amounts)).sort(byCode) }))
    .filter((row) => !isZeroRow(row.amounts) || row.rows.length > 0)
    .sort((left, right) => order
      ? order.indexOf(left.key) - order.indexOf(right.key)
      : left.label.localeCompare(right.label));
  return [...categories, ...[...loose.values()].filter((leaf) => !isZeroRow(leaf.amounts)).sort(byCode)];
}

function totalOf(rows: readonly StatementRow[], columns: number) {
  return Array.from({ length: columns }, (_, column) => add(...rows.map((row) => row.amounts[column])));
}

/** A P&L with one column per period from facts; totals, gross and net margins per column. */
export function buildProfitAndLoss(header: Omit<StatementHeader, "columns">, columns: StatementColumn[], facts: readonly PnlFact[]): ProfitAndLossStatement {
  const count = columns.length;
  const sections: FinancialStatementSection[] = PNL_SECTIONS.map((key) => {
    const rows = sectionRows(key, facts.filter((fact) => fact.section === key), count);
    return { key, label: SECTION_LABELS[key], rows, total: totalOf(rows, count) };
  });
  return { ...header, columns, statement: "profit_and_loss", sections, totals: pnlTotals(sections, count) };
}

function pnlTotals(sections: readonly FinancialStatementSection[], count: number): ProfitAndLossStatement["totals"] {
  const of = (key: PnlSectionKey) => sections.find((section) => section.key === key)?.total ?? zeros(count);
  const revenue = of("revenue"), costOfSales = of("cost_of_sales"), operatingExpenses = of("operating_expenses");
  const otherIncome = of("other_income"), otherExpenses = of("other_expenses");
  const each = (work: (column: number) => Money) => Array.from({ length: count }, (_, column) => work(column));
  const grossProfit = each((c) => sub(revenue[c], costOfSales[c]));
  const operatingProfit = each((c) => sub(grossProfit[c], operatingExpenses[c]));
  const netProfit = each((c) => sub(add(operatingProfit[c], otherIncome[c]), otherExpenses[c]));
  return {
    revenue, costOfSales, grossProfit, grossMarginPercent: grossProfit.map((value, c) => percent(value, revenue[c])),
    operatingExpenses, operatingProfit, otherIncome, otherExpenses, netProfit, netMarginPercent: netProfit.map((value, c) => percent(value, revenue[c])),
  };
}

/** Rows of `left` and `right` matched by key (recursively), amounts side by side; rows only one side has get zeros on the other. */
function mergeRows(left: readonly StatementRow[], right: readonly StatementRow[], leftCount: number, rightCount: number): StatementRow[] {
  const out: StatementRow[] = [];
  const rightByKey = new Map(right.map((row) => [row.key, row]));
  for (const row of left) {
    const other = rightByKey.get(row.key);
    rightByKey.delete(row.key);
    out.push(joinRow(row, other, leftCount, rightCount));
  }
  for (const other of rightByKey.values()) out.push(joinRow(undefined, other, leftCount, rightCount));
  return out;
}

function joinRow(left: StatementRow | undefined, right: StatementRow | undefined, leftCount: number, rightCount: number): StatementRow {
  const base = (left ?? right)!;
  const rows = left?.rows || right?.rows ? mergeRows(left?.rows ?? [], right?.rows ?? [], leftCount, rightCount) : undefined;
  return { ...base, amounts: [...(left?.amounts ?? zeros(leftCount)), ...(right?.amounts ?? zeros(rightCount))], ...(rows ? { rows } : {}) };
}

/**
 * A P&L with the comparison's columns after the current ones (each source returns one period; the comparison is
 * merged here). Category order stays the statement's; rows only the comparison has go after the current ones.
 */
export function mergeProfitAndLoss(current: ProfitAndLossStatement, comparison: ProfitAndLossStatement): ProfitAndLossStatement {
  const leftCount = current.columns.length, rightCount = comparison.columns.length;
  const sections = PNL_SECTIONS.map((key) => {
    const left = current.sections.find((section) => section.key === key);
    const right = comparison.sections.find((section) => section.key === key);
    const rows = mergeRows(left?.rows ?? [], right?.rows ?? [], leftCount, rightCount);
    const order = ORDERED_CATEGORIES[key];
    if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return { key, label: left?.label ?? right?.label ?? SECTION_LABELS[key], rows,
      total: [...(left?.total ?? zeros(leftCount)), ...(right?.total ?? zeros(rightCount))] };
  });
  const columns = [...current.columns, ...comparison.columns.map((column) => ({ ...column, role: "comparison" as const }))];
  return { ...current, columns, sections, totals: pnlTotals(sections, columns.length), notes: [...new Set([...current.notes, ...comparison.notes])] };
}

// ---------------------------------------------------------------------------------------------------------------
// Cash flow.

/** Money that moved in a month: cash in (positive in, a reversal negative) or cash out (positive out). */
export type CashFact = { column: number; section: "cash_in" | "cash_out"; row: string; label?: string; amount: Money };
/** One bank or cash account: its balance before the first month and its net movement each month. */
export type CashAccountFact = { key: string; label: string; accountId: string | null; opening: Money; movements: Money[] };

export function buildCashFlow(header: Omit<StatementHeader, "columns">, columns: StatementColumn[], input: {
  facts: readonly CashFact[];
  accounts: readonly CashAccountFact[];
  /** Cash before the first month when there are no accounts (operational cash: the net of what was recorded before). */
  opening?: Money;
  forecast?: CashFlowForecast | null;
}): CashFlowStatement {
  const count = columns.length;
  const section = (key: "cash_in" | "cash_out", fixed: readonly string[], label: string): FinancialStatementSection => {
    const rows = new Map<string, StatementRow>();
    for (const fact of input.facts.filter((item) => item.section === key)) {
      let row = rows.get(fact.row);
      if (!row) { row = { key: fact.row, label: fact.label ?? CATEGORY_LABELS[fact.row] ?? fact.row, amounts: zeros(count) }; rows.set(fact.row, row); }
      addInto(row.amounts, fact.column, fact.amount);
    }
    const ordered = [...rows.values()].filter((row) => !isZeroRow(row.amounts))
      .sort((a, b) => (fixed.indexOf(a.key) < 0 ? 99 : fixed.indexOf(a.key)) - (fixed.indexOf(b.key) < 0 ? 99 : fixed.indexOf(b.key)) || a.label.localeCompare(b.label));
    return { key, label, rows: ordered, total: totalOf(ordered, count) };
  };
  const cashIn = section("cash_in", CASH_IN_ROWS, "Cash in");
  const cashOut = section("cash_out", CASH_OUT_ROWS, "Cash out");
  const netCashFlow = Array.from({ length: count }, (_, c) => sub(cashIn.total[c], cashOut.total[c]));
  const accounts: CashAccountBalance[] = input.accounts.map((account) => {
    const opening: Money[] = [], closing: Money[] = [];
    let balance = units(account.opening);
    for (let c = 0; c < count; c += 1) { opening.push(money(balance)); balance += units(account.movements[c]); closing.push(money(balance)); }
    return { key: account.key, label: account.label, accountId: account.accountId, opening, closing };
  });
  const opening: Money[] = [], closing: Money[] = [];
  let balance = input.accounts.length ? input.accounts.reduce((sum, account) => sum + units(account.opening), 0n) : units(input.opening ?? ZERO);
  for (let c = 0; c < count; c += 1) { opening.push(money(balance)); balance += units(netCashFlow[c]); closing.push(money(balance)); }
  return { ...header, columns, statement: "cash_flow", sections: [cashIn, cashOut], netCashFlow, opening, closing, accounts, forecast: input.forecast ?? null };
}

/** The 90-day forecast: what is due in and out per bucket, and the cash it leaves from `closing`. */
export function buildForecast(columns: StatementColumn[], receipts: readonly Money[], payments: readonly Money[], closing: Money): CashFlowForecast {
  const net = columns.map((_, c) => sub(receipts[c] ?? ZERO, payments[c] ?? ZERO));
  let balance = units(closing);
  const running = net.map((value) => { balance += units(value); return money(balance); });
  return { columns, receipts: columns.map((_, c) => receipts[c] ?? ZERO), payments: columns.map((_, c) => payments[c] ?? ZERO), net, closing: running };
}
