// Structural copy of the financial statement shapes in packages/contracts/src/financial-statements.ts (business-core
// does not depend on contracts). statement-types.spec.ts keeps both in step.

export const FINANCIAL_STATEMENT_SOURCES = ["ledger", "zoho_books", "quickbooks", "operational_cash"] as const;
export type FinancialStatementSource = (typeof FINANCIAL_STATEMENT_SOURCES)[number];

export const STATEMENT_BASES = ["accrual", "cash"] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

export const PNL_SECTIONS = ["revenue", "cost_of_sales", "operating_expenses", "other_income", "other_expenses"] as const;
export type PnlSectionKey = (typeof PNL_SECTIONS)[number];

/** Decimal text with 4 places. */
export type Money = string;
/** YYYY-MM-DD. */
export type IsoDay = string;

export type StatementSourceCapabilities = { accrual: boolean; cash: boolean; drillDown: boolean; cashAccounts: boolean; forecast: boolean };

export type StatementQuery = { legalEntityId: string; projectId?: string | null; from: IsoDay; to: IsoDay; basis: StatementBasis };

export type StatementColumn = { key: string; from: IsoDay; to: IsoDay; role: "current" | "comparison" | "month" | "forecast" };

export type StatementRow = {
  key: string;
  label: string;
  code?: string | null;
  accountId?: string | null;
  href?: string | null;
  amounts: Money[];
  rows?: StatementRow[];
};

export type FinancialStatementSection = { key: string; label: string; rows: StatementRow[]; total: Money[] };

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
  sourceLabel: string | null;
  basis: StatementBasis;
  currency: string;
  legalEntityId: string;
  projectId: string | null;
  columns: StatementColumn[];
  generatedAt: string;
  notes: string[];
};

export type ProfitAndLossStatement = StatementHeader & { statement: "profit_and_loss"; sections: FinancialStatementSection[]; totals: ProfitAndLossTotals };

export type CashAccountBalance = { key: string; label: string; accountId: string | null; opening: Money[]; closing: Money[] };

export type CashFlowForecast = { columns: StatementColumn[]; receipts: Money[]; payments: Money[]; net: Money[]; closing: Money[] };

export type CashFlowStatement = StatementHeader & {
  statement: "cash_flow";
  sections: FinancialStatementSection[];
  netCashFlow: Money[];
  opening: Money[];
  closing: Money[];
  accounts: CashAccountBalance[];
  forecast: CashFlowForecast | null;
};

export interface FinancialStatementProvider {
  readonly source: FinancialStatementSource;
  capabilities(): Promise<StatementSourceCapabilities>;
  profitAndLoss(query: StatementQuery): Promise<ProfitAndLossStatement>;
  cashFlow(query: StatementQuery): Promise<CashFlowStatement>;
}
