import { Injectable } from "@nestjs/common";
import type { Db } from "../ledger/ledger";
import type { FinancialStatementProvider, FinancialStatementSource } from "./statement-contract";

/**
 * Where a company's statements come from (plan §6.21b, company and project P&L and cash flow).
 *
 * `statementSource(context)` (statements.service.ts) picks the company's chosen source and returns its provider;
 * the page, CSV and PDF read `.profitAndLoss(query)` and `.cashFlow(query)` from it and never care which it is.
 * The Ledger and operational-cash sources live in this folder. Zoho Books and QuickBooks live in `src/books/sources`;
 * BooksStatementsModule registers them on init.
 */

/** What every source gets: the member's tenant transaction and the company it reads. */
export type StatementSourceContext = {
  /** The tenant transaction (RLS scoped to the workspace); never commit or roll back from a source. */
  db: Db;
  workspaceId: string;
  legalEntityId: string;
  /** The company's reporting currency: the Ledger's functional currency, else the workspace's base currency. */
  currency: string;
  locale: string;
  timeZone: string;
  /** Today in the company's time zone (YYYY-MM-DD). */
  today: string;
  /** 1–12, from the Ledger settings, else the workspace's region pack. */
  fiscalYearStartMonth: number;
  /** The member reading, for sources that audit or rate-limit. */
  userId: string;
};

export type StatementSourceAvailability = { available: boolean; label: string | null };

/** One source of statements, registered by `source`. */
export interface StatementSourceAdapter {
  readonly source: FinancialStatementSource;
  /** Can it serve this company now (the Ledger is on, the accounting system is connected), and under what name. */
  availability(context: StatementSourceContext): Promise<StatementSourceAvailability>;
  /** The provider for this company; statements read through it. */
  provider(context: StatementSourceContext): FinancialStatementProvider;
}

@Injectable()
export class StatementSourceRegistry {
  private readonly adapters = new Map<FinancialStatementSource, StatementSourceAdapter>();

  register(adapter: StatementSourceAdapter) {
    this.adapters.set(adapter.source, adapter);
  }

  get(source: FinancialStatementSource): StatementSourceAdapter | undefined {
    return this.adapters.get(source);
  }

  list(): StatementSourceAdapter[] {
    return [...this.adapters.values()];
  }
}
