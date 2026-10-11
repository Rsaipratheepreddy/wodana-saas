import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { ProviderReportsClient, StatementSourceError, type AccountingProviderKind, type ProviderReportResponse } from "./provider-reports.client";
import { mapQuickBooksCashFlow, mapQuickBooksProfitAndLoss, type QuickBooksReport } from "./quickbooks-statements";
import { monthColumns } from "./statement-math";
import type { CashFlowStatement, FinancialStatementProvider, ProfitAndLossStatement, StatementColumn, StatementQuery, StatementSourceCapabilities } from "./statement-types";
import { mapZohoCashFlow, mapZohoProfitAndLoss, type ZohoReport } from "./zoho-books-statements";

/**
 * Financial statements from the firm's own accounting system (plan §6.21b, §6.25): the company's P&L and cash flow as
 * QuickBooks Online or Zoho Books report them, for one legal entity, through the connection that company posts to
 * (Settings › Accounting). Company level only: Wodana's accounting sync posts without a project class or tag, so the
 * accounting system can't split its reports by project.
 */

type Db = Pick<PoolClient, "query">;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A cash flow reads one report per month from Zoho Books; two years is the most one statement asks for. */
export const MAX_MONTHS = 24;

const PROVIDER_NAMES: Record<AccountingProviderKind, string> = { quickbooks: "QuickBooks", zoho_books: "Zoho Books" };

export const EXTERNAL_CAPABILITIES: StatementSourceCapabilities = { accrual: true, cash: true, drillDown: false, cashAccounts: false, forecast: false };

export type CompanyLink = { connectionId: string; companyName: string; baseCurrency: string };

/** The connection a company posts to, when it's this provider and still connected. */
export async function companyLink(db: Db, workspaceId: string, legalEntityId: string, provider: AccountingProviderKind): Promise<CompanyLink | null> {
  return (await db.query<CompanyLink>(
    `SELECT link.connection_id AS "connectionId", entity.display_name AS "companyName", entity.base_currency AS "baseCurrency"
       FROM accounting_links link
       JOIN integration_connections connection ON connection.workspace_id = link.workspace_id AND connection.id = link.connection_id
        AND connection.provider = $3 AND connection.status IN ('connected', 'degraded')
       JOIN legal_entities entity ON entity.workspace_id = link.workspace_id AND entity.id = link.legal_entity_id
      WHERE link.workspace_id = $1 AND link.legal_entity_id = $2 AND link.active`, [workspaceId, legalEntityId, provider])).rows[0] ?? null;
}

function checkQuery(query: StatementQuery) {
  if (!DAY.test(query.from) || !DAY.test(query.to) || query.from > query.to) throw new StatementSourceError("refused", "Choose a period that starts before it ends.");
  if (query.projectId) throw new StatementSourceError("unsupported");
}

/** One accounting system's statements for one workspace (the caller holds the tenant transaction). */
export function externalStatementProvider(source: AccountingProviderKind, context: { db: Db; workspaceId: string; reports: ProviderReportsClient; now?: () => Date }):
  FinancialStatementProvider {
  const now = context.now ?? (() => new Date());
  const read = async (query: StatementQuery, report: "profit_and_loss" | "cash_flow", columns: StatementColumn[]) => {
    const link = await companyLink(context.db, context.workspaceId, query.legalEntityId, source);
    if (!link) throw new StatementSourceError("not_connected");
    const response = await context.reports.fetch({
      workspaceId: context.workspaceId, connectionId: link.connectionId, provider: source, report, basis: query.basis,
      columns: report === "cash_flow" ? "month" : "total", periods: columns.map((column) => ({ from: column.from, to: column.to })),
    });
    const notes = response.currency ? [] : [`The accounting system didn't say its currency; ${link.baseCurrency} is assumed.`];
    const header = {
      sourceLabel: `${PROVIDER_NAMES[source]} · ${link.companyName}`, basis: query.basis, currency: response.currency ?? link.baseCurrency,
      legalEntityId: query.legalEntityId, projectId: null, generatedAt: now().toISOString(),
    };
    return { response, header, notes };
  };
  const mapped = <T>(work: () => T): T => {
    try { return work(); } catch (error) {
      if (error instanceof StatementSourceError) throw error;
      throw new StatementSourceError("refused");
    }
  };
  const withNotes = <T extends { notes: string[] }>(statement: T, notes: string[]): T => ({ ...statement, notes: [...notes, ...statement.notes] });
  const dataOf = (response: ProviderReportResponse) => response.reports.map((item) => item.data);
  return {
    source,
    capabilities: async () => EXTERNAL_CAPABILITIES,
    async profitAndLoss(query) {
      checkQuery(query);
      const columns: StatementColumn[] = [{ key: "current", from: query.from, to: query.to, role: "current" }];
      const { response, header, notes } = await read(query, "profit_and_loss", columns);
      const statement: ProfitAndLossStatement = mapped(() => source === "quickbooks"
        ? mapQuickBooksProfitAndLoss((dataOf(response)[0] ?? {}) as QuickBooksReport, header, columns)
        : mapZohoProfitAndLoss(dataOf(response) as ZohoReport[], header, columns));
      return withNotes(statement, notes);
    },
    async cashFlow(query) {
      checkQuery(query);
      const columns = monthColumns(query.from, query.to);
      if (columns.length > MAX_MONTHS) throw new StatementSourceError("refused", `Choose at most ${MAX_MONTHS} months.`);
      const { response, header, notes } = await read(query, "cash_flow", columns);
      const statement: CashFlowStatement = mapped(() => source === "quickbooks"
        ? mapQuickBooksCashFlow((dataOf(response)[0] ?? {}) as QuickBooksReport, header, columns)
        : mapZohoCashFlow(dataOf(response) as ZohoReport[], header, columns));
      return withNotes(statement, notes);
    },
  };
}

/** Hands the Ledger's statements page a provider for QuickBooks or Zoho Books, inside the caller's tenant transaction. */
@Injectable()
export class ExternalStatementSources {
  constructor(private readonly reports: ProviderReportsClient) {}

  forWorkspace(db: Db, workspaceId: string, source: AccountingProviderKind): FinancialStatementProvider {
    return externalStatementProvider(source, { db, workspaceId, reports: this.reports });
  }

  /** Whether this company posts to the accounting system now (the statements source picker offers it only then). */
  async available(db: Db, workspaceId: string, legalEntityId: string, source: AccountingProviderKind) {
    const link = await companyLink(db, workspaceId, legalEntityId, source);
    return { available: Boolean(link), label: link ? `${PROVIDER_NAMES[source]} · ${link.companyName}` : null, capabilities: EXTERNAL_CAPABILITIES };
  }
}
