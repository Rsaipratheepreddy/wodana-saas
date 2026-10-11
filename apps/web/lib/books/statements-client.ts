import type {
  CashFlowStatement, FinancialStatementSource, IsoDay, ProfitAndLossStatement, StatementBasis, StatementComparison, StatementSourceCapabilities,
  StatementSourceSettings,
} from "@wodana/contracts";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { LedgerRequestError } from "./reports-client";

/**
 * Company statements (P&L and cash flow) and where they come from, as business-core returns them
 * (services/business-core/src/books/statements/statements.ts) through /api/books/statements. Figures are exact
 * decimal text worked out server-side; the web only lays them out. Statement shapes are the shared contract's
 * (packages/contracts/src/financial-statements.ts).
 */

export type { CashFlowStatement, FinancialStatementSource, ProfitAndLossStatement, StatementBasis, StatementComparison };

export type StatementCompany = {
  id: string; code: string; name: string; currency: string; locale: string; timeZone: string; countryCode: string; today: IsoDay;
  fiscalYearStartMonth: number; ledgerOn: boolean;
};
export type StatementSourceInfo = { source: FinancialStatementSource; label: string | null; chosen: boolean; capabilities: StatementSourceCapabilities };
export type StatementResponse<S> = {
  statement: S; company: StatementCompany; companies: StatementCompany[]; source: StatementSourceInfo;
  period: { from: IsoDay; to: IsoDay }; comparison: { from: IsoDay; to: IsoDay } | null; compare: StatementComparison;
};
export type StatementSourceView = StatementSourceSettings & { company: StatementCompany; companies: StatementCompany[]; canManage: boolean };

/** What a statement reads, kept in the address: company, period, basis and comparison (empty = the server's default). */
export type StatementScope = { entity: string; from: string; to: string; basis: string; compare: string };

export const SOURCE_LABELS: Record<FinancialStatementSource, MessageKey> = {
  ledger: tKey("Wodana Ledger"), zoho_books: tKey("Zoho Books"), quickbooks: tKey("QuickBooks"), operational_cash: tKey("Operational cash"),
};
export const BASIS_LABELS: Record<StatementBasis, MessageKey> = { accrual: tKey("Accrual"), cash: tKey("Cash") };
export const COMPARISON_LABELS: Record<StatementComparison, MessageKey> = {
  none: tKey("No comparison"), previous_period: tKey("Previous period"), previous_year: tKey("Same period last year"),
};
/** Fixed row and section labels the server names (account names are shown as they are). */
export const STATEMENT_LABELS: readonly MessageKey[] = [
  tKey("Revenue"), tKey("Cost of sales"), tKey("Operating expenses"), tKey("Other income"), tKey("Other expenses"), tKey("Design fees"),
  tKey("Production and fit-out"), tKey("Variations"), tKey("Other revenue"), tKey("Materials"), tKey("Subcontract and labour"), tKey("Factory"),
  tKey("Other costs"), tKey("Supplier charges"), tKey("Cash in"), tKey("Cash out"), tKey("Client payments"), tKey("Client advances"), tKey("Other receipts"),
  tKey("Supplier payments"), tKey("Payroll and labour"), tKey("Expenses"), tKey("Tax"), tKey("Other payments"),
  tKey("Cash basis: client payments, supplier payments and petty cash, net of tax"), tKey("Some amounts have no exchange rate and are left out"),
  tKey("Some project costs have no rate yet and are left out"), tKey("From payments, invoices and bills recorded in Wodana"),
  tKey("Opening cash is what Wodana recorded before the period"),
];

async function request<T>(workspaceId: string, path: string, init: { query?: URLSearchParams; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const search = new URLSearchParams(init.query);
  search.set("workspaceId", workspaceId);
  const response = await fetch(`/api/books/statements/${path}?${search}`, init.body === undefined
    ? { cache: "no-store", signal: init.signal }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.body), cache: "no-store", signal: init.signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LedgerRequestError(typeof data?.message === "string" ? data.message : tKey("The Ledger didn't load."), response.status);
  return data as T;
}

const queryOf = (scope: Partial<StatementScope>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(scope)) if (value) query.set(key, value);
  return query;
};

/** The statements of one workspace. */
export function statementsApi(workspaceId: string) {
  return {
    profitAndLoss: (scope: Partial<StatementScope>, signal?: AbortSignal) =>
      request<StatementResponse<ProfitAndLossStatement>>(workspaceId, "profit-and-loss", { query: queryOf(scope), signal }),
    cashFlow: (scope: Partial<StatementScope>, signal?: AbortSignal) =>
      request<StatementResponse<CashFlowStatement>>(workspaceId, "cash-flow", { query: queryOf({ entity: scope.entity, from: scope.from, to: scope.to }), signal }),
    source: (entity: string, signal?: AbortSignal) => request<StatementSourceView>(workspaceId, "source", { query: queryOf({ entity }), signal }),
    setSource: (input: { legalEntityId: string; source: FinancialStatementSource; expectedVersion: number }) =>
      request<StatementSourceView>(workspaceId, "source", { body: { ...input, commandId: crypto.randomUUID() } }),
    /** The CSV file of a statement (same figures as the screen). */
    csvHref: (statement: "profit-and-loss" | "cash-flow", scope: Partial<StatementScope>) => {
      const query = queryOf(statement === "cash-flow" ? { entity: scope.entity, from: scope.from, to: scope.to } : scope);
      query.set("format", "csv");
      query.set("workspaceId", workspaceId);
      return `/api/books/statements/${statement}?${query}`;
    },
  };
}
export type StatementsApi = ReturnType<typeof statementsApi>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function statementScopeFrom(params: URLSearchParams): StatementScope {
  const day = (key: string) => (DAY.test(params.get(key) ?? "") ? params.get(key)! : "");
  const basis = params.get("basis") === "cash" ? "cash" : "";
  const compare = ["previous_period", "previous_year"].includes(params.get("compare") ?? "") ? params.get("compare")! : "";
  return { entity: UUID.test(params.get("entity") ?? "") ? params.get("entity")! : "", from: day("from"), to: day("to"), basis, compare };
}
