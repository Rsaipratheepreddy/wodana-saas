// Structural copy of packages/contracts/src/financial-statements.ts (business-core does not depend on contracts).
// statement-contract.spec.ts keeps both in step. Money is decimal text with 4 places; percentages have 1 place.

export type Money = string;
export type IsoDay = string;

export const FINANCIAL_STATEMENT_SOURCES = ["ledger", "zoho_books", "quickbooks", "operational_cash"] as const;
export type FinancialStatementSource = (typeof FINANCIAL_STATEMENT_SOURCES)[number];

export const STATEMENT_BASES = ["accrual", "cash"] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

export const STATEMENT_COMPARISONS = ["none", "previous_period", "previous_year"] as const;
export type StatementComparison = (typeof STATEMENT_COMPARISONS)[number];

export type StatementKind = "profit_and_loss" | "cash_flow";

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

export const PNL_SECTIONS = ["revenue", "cost_of_sales", "operating_expenses", "other_income", "other_expenses"] as const;
export type PnlSectionKey = (typeof PNL_SECTIONS)[number];
export const PNL_REVENUE_CATEGORIES = ["design_fees", "production", "variations", "other_revenue"] as const;
export const PNL_COST_CATEGORIES = ["materials", "subcontract_labour", "factory", "other_costs"] as const;
export type PnlRevenueCategory = (typeof PNL_REVENUE_CATEGORIES)[number];
export type PnlCostCategory = (typeof PNL_COST_CATEGORIES)[number];

export type ProfitAndLossTotals = {
  revenue: Money[]; costOfSales: Money[]; grossProfit: Money[]; grossMarginPercent: Array<string | null>;
  operatingExpenses: Money[]; operatingProfit: Money[]; otherIncome: Money[]; otherExpenses: Money[];
  netProfit: Money[]; netMarginPercent: Array<string | null>;
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

export const CASH_FLOW_SECTIONS = ["cash_in", "cash_out"] as const;
export const CASH_IN_ROWS = ["client_payments", "client_advances", "other_receipts"] as const;
export const CASH_OUT_ROWS = ["supplier_payments", "labour", "expenses", "tax", "other_payments"] as const;
export type CashInRow = (typeof CASH_IN_ROWS)[number];
export type CashOutRow = (typeof CASH_OUT_ROWS)[number];

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

export type FinancialStatement = ProfitAndLossStatement | CashFlowStatement;

export interface FinancialStatementProvider {
  readonly source: FinancialStatementSource;
  capabilities(): Promise<StatementSourceCapabilities>;
  profitAndLoss(query: StatementQuery): Promise<ProfitAndLossStatement>;
  cashFlow(query: StatementQuery): Promise<CashFlowStatement>;
}

export type StatementSourceOption = { source: FinancialStatementSource; available: boolean; label: string | null; capabilities: StatementSourceCapabilities };
export type StatementSourceSettings = {
  legalEntityId: string; source: FinancialStatementSource; chosen: boolean; version: number; options: StatementSourceOption[];
};
export type SetStatementSourceCommand = { legalEntityId: string; source: FinancialStatementSource; expectedVersion: number };
