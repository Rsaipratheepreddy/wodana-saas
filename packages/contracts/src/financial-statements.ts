/**
 * Financial statements (Wodana Ledger, plan §6.21b): the profit and loss and the cash flow, at company level
 * (one legal entity) or project level (one project), read from wherever the firm's books live.
 *
 * Every source returns the same shapes, so the page, the CSV and the PDF never care where the figures came from:
 * - `ledger`: Wodana Ledger journals (accrual, cash basis from paid documents, drill-down to accounts and journals);
 * - `zoho_books` / `quickbooks`: the connected accounting system's reports (adapters in business-core src/books/sources);
 * - `operational_cash`: Wodana's own receipts, supplier payments, petty cash and invoices/bills, without full books.
 *
 * Money is decimal text with 4 places (never a float), in the statement's `currency`. Percentages are decimal text
 * with 1 place ("23.5"), null when the base is zero. Labels of fixed rows are English text (the web translates them
 * with t()); account names from a chart are shown as they are.
 */
import type { IsoDay, Money } from "./books.js";

export const FINANCIAL_STATEMENT_SOURCES = ["ledger", "zoho_books", "quickbooks", "operational_cash"] as const;
export type FinancialStatementSource = (typeof FINANCIAL_STATEMENT_SOURCES)[number];

/** Accrual reads invoices and bills when issued; cash reads money when it moved. */
export const STATEMENT_BASES = ["accrual", "cash"] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

/** The comparison column of a P&L: none, the period just before (same length), or the same period last year. */
export const STATEMENT_COMPARISONS = ["none", "previous_period", "previous_year"] as const;
export type StatementComparison = (typeof STATEMENT_COMPARISONS)[number];

export type StatementKind = "profit_and_loss" | "cash_flow";

/** What a source can give; the page offers only what it can. */
export type StatementSourceCapabilities = {
  accrual: boolean;
  cash: boolean;
  /** Lines open the Ledger account and its journals. */
  drillDown: boolean;
  /** Opening and closing cash per bank or cash account. */
  cashAccounts: boolean;
  /** The 90-day forecast from receivables and payables due. */
  forecast: boolean;
};

/** One query to a source: one company (or one project of it) and one period, inclusive. */
export type StatementQuery = {
  legalEntityId: string;
  /** Project-level statements; null for the whole company. */
  projectId?: string | null;
  from: IsoDay;
  to: IsoDay;
  basis: StatementBasis;
};

/** A column of figures: the period, its comparison, a month of a cash flow, or a forecast bucket. */
export type StatementColumn = {
  key: string;
  from: IsoDay;
  to: IsoDay;
  role: "current" | "comparison" | "month" | "forecast";
};

/**
 * A row of a statement. `amounts` has one entry per column of the statement (same order). A row is either a
 * category with child rows (e.g. "Design fees" with its accounts) or a leaf (an account, a kind of receipt).
 */
export type StatementRow = {
  /** Stable within the statement: a category key ("design_fees") or "account:<id>". */
  key: string;
  label: string;
  /** The account code when the row is an account of a chart. */
  code?: string | null;
  /** The Ledger account the row drills into (books_accounts.id), when the source is the Ledger. */
  accountId?: string | null;
  /** A link to the source document or report when the source is not the Ledger. */
  href?: string | null;
  amounts: Money[];
  rows?: StatementRow[];
};

/** A section with its total per column (revenue, cost of sales, cash in...). */
export type FinancialStatementSection = { key: string; label: string; rows: StatementRow[]; total: Money[] };

/** The fixed P&L sections, in order. */
export const PNL_SECTIONS = ["revenue", "cost_of_sales", "operating_expenses", "other_income", "other_expenses"] as const;
export type PnlSectionKey = (typeof PNL_SECTIONS)[number];
/** The categories inside revenue and cost of sales (operating expenses group by account group). */
export const PNL_REVENUE_CATEGORIES = ["design_fees", "production", "variations", "other_revenue"] as const;
export const PNL_COST_CATEGORIES = ["materials", "subcontract_labour", "factory", "other_costs"] as const;
export type PnlRevenueCategory = (typeof PNL_REVENUE_CATEGORIES)[number];
export type PnlCostCategory = (typeof PNL_COST_CATEGORIES)[number];

export type ProfitAndLossTotals = {
  revenue: Money[];
  costOfSales: Money[];
  grossProfit: Money[];
  grossMarginPercent: Array<string | null>;
  operatingExpenses: Money[];
  operatingProfit: Money[];
  otherIncome: Money[];
  otherExpenses: Money[];
  netProfit: Money[];
  netMarginPercent: Array<string | null>;
};

export type StatementHeader = {
  source: FinancialStatementSource;
  /** The connection or company the figures came from, e.g. "Zoho Books · Palm Living LLC". */
  sourceLabel: string | null;
  basis: StatementBasis;
  currency: string;
  legalEntityId: string;
  projectId: string | null;
  columns: StatementColumn[];
  generatedAt: string;
  /** Short facts the reader should know (e.g. "3 costs not costed"), one muted line each. */
  notes: string[];
};

export type ProfitAndLossStatement = StatementHeader & {
  statement: "profit_and_loss";
  sections: FinancialStatementSection[];
  totals: ProfitAndLossTotals;
};

/** The fixed cash flow sections and their rows (direct method). */
export const CASH_FLOW_SECTIONS = ["cash_in", "cash_out"] as const;
export const CASH_IN_ROWS = ["client_payments", "client_advances", "other_receipts"] as const;
export const CASH_OUT_ROWS = ["supplier_payments", "labour", "expenses", "tax", "other_payments"] as const;
export type CashInRow = (typeof CASH_IN_ROWS)[number];
export type CashOutRow = (typeof CASH_OUT_ROWS)[number];

/** Cash held in one bank or cash account, at the start and end of every column. */
export type CashAccountBalance = { key: string; label: string; accountId: string | null; opening: Money[]; closing: Money[] };

/** The next 90 days from what is scheduled: receivables due in, payables due out, in 30-day buckets. */
export type CashFlowForecast = {
  columns: StatementColumn[];
  receipts: Money[];
  payments: Money[];
  net: Money[];
  /** Closing cash of the last actual month plus the net so far. */
  closing: Money[];
};

export type CashFlowStatement = StatementHeader & {
  statement: "cash_flow";
  /** cash_in and cash_out, one column per month (role "month"). */
  sections: FinancialStatementSection[];
  netCashFlow: Money[];
  opening: Money[];
  closing: Money[];
  accounts: CashAccountBalance[];
  forecast: CashFlowForecast | null;
};

export type FinancialStatement = ProfitAndLossStatement | CashFlowStatement;

/**
 * One source of statements (business-core implements one per source and registers it by `source`).
 * `profitAndLoss` returns a single "current" column for the query's period; comparisons are merged by the caller.
 * `cashFlow` returns one "month" column per calendar month the period touches, and the forecast when it can.
 */
export interface FinancialStatementProvider {
  readonly source: FinancialStatementSource;
  capabilities(): Promise<StatementSourceCapabilities>;
  profitAndLoss(query: StatementQuery): Promise<ProfitAndLossStatement>;
  cashFlow(query: StatementQuery): Promise<CashFlowStatement>;
}

/** Settings › Ledger › Statements: where one company's books live (books_statement_sources). */
export type StatementSourceOption = {
  source: FinancialStatementSource;
  /** Usable now: the Ledger is on, or the accounting system is connected for this company. */
  available: boolean;
  /** The connection's name when it is an accounting system. */
  label: string | null;
  capabilities: StatementSourceCapabilities;
};
export type StatementSourceSettings = {
  legalEntityId: string;
  source: FinancialStatementSource;
  /** False when nobody chose yet and the default applies (the Ledger when on, else operational cash). */
  chosen: boolean;
  version: number;
  options: StatementSourceOption[];
};
export type SetStatementSourceCommand = { legalEntityId: string; source: FinancialStatementSource; expectedVersion: number };

/** Change from the comparison to the current amount, and as a percentage of the comparison (null when it is zero). */
export function statementChange(current: Money, previous: Money): { change: Money; percent: string | null } {
  const scale = (value: string) => {
    const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
    if (!match) return 0n;
    const units = BigInt(match[2]) * 10_000n + BigInt((match[3] ?? "").padEnd(4, "0"));
    return match[1] ? -units : units;
  };
  const format = (units: bigint) => {
    const negative = units < 0n;
    const abs = negative ? -units : units;
    return `${negative ? "-" : ""}${abs / 10_000n}.${String(abs % 10_000n).padStart(4, "0")}`;
  };
  const now = scale(current);
  const before = scale(previous);
  const change = now - before;
  if (before === 0n) return { change: format(change), percent: null };
  const base = before < 0n ? -before : before;
  // One decimal place, half away from zero.
  const tenths = (change * 1000n * 2n + (change < 0n ? -base : base)) / (2n * base);
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  return { change: format(change), percent: `${negative ? "-" : ""}${abs / 10n}.${abs % 10n}` };
}

/** API routes (business-core): `/workspaces/:workspaceId/books/statements/...`. */
export const STATEMENT_ROUTES = {
  profitAndLoss: "statements/profit-and-loss",
  cashFlow: "statements/cash-flow",
  source: "statements/source",
} as const;
