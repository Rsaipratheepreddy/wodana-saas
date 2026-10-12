import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { BOOKS_PERMISSIONS } from "../books-contract";
import { BOOKS_SWEEP, type BooksSweepPort } from "../reports/books-sweep.port";
import { csvFileName } from "../reports/report-csv";
import { booksCtx } from "../settings/books-settings.service";
import { ledgerStatementSource } from "./ledger-source";
import { operationalStatementSource } from "./operational-source";
import { cashFlowCsv, profitAndLossCsv } from "./statement-csv";
import { StatementSourceRegistry } from "./statement-source";
import { readCashFlow, readProfitAndLoss, readSourceView, setStatementSource } from "./statements";

export type CsvFile = { fileName: string; body: string };

/**
 * Company statements (books.view) and where they come from (books.manage chooses). The Ledger and operational cash
 * register here; Zoho Books and QuickBooks register from src/books/sources. Reads sweep the Ledger first, so a
 * statement from the Ledger shows what happened up to now.
 */
@Injectable()
export class BooksStatementsService {
  private readonly logger = new Logger(BooksStatementsService.name);

  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly registry: StatementSourceRegistry,
    @Optional() @Inject(BOOKS_SWEEP) private readonly sweep?: BooksSweepPort,
  ) {
    registry.register(ledgerStatementSource);
    registry.register(operationalStatementSource);
  }

  private async sweepFirst(actor: RequestActor, workspaceId: string) {
    if (!this.sweep) return;
    // Only a member may make a workspace post its pending events; the read still checks the Ledger permission.
    await this.access.asMember(actor, workspaceId, async () => undefined);
    try { await this.sweep.runSweepNow(workspaceId); } catch (error) {
      this.logger.warn(`Ledger sweep before a statement failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async profitAndLoss(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    await this.sweepFirst(actor, workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.view, (client, user) => readProfitAndLoss(this.registry, client, workspaceId, user.userId, query));
  }

  async profitAndLossFile(actor: RequestActor, workspaceId: string, query: Record<string, unknown>): Promise<CsvFile> {
    const response = await this.profitAndLoss(actor, workspaceId, query);
    return { fileName: csvFileName(`${response.company.code}-profit-and-loss`, response.period), body: profitAndLossCsv(response) };
  }

  async cashFlow(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    await this.sweepFirst(actor, workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.view, (client, user) => readCashFlow(this.registry, client, workspaceId, user.userId, query));
  }

  async cashFlowFile(actor: RequestActor, workspaceId: string, query: Record<string, unknown>): Promise<CsvFile> {
    const response = await this.cashFlow(actor, workspaceId, query);
    return { fileName: csvFileName(`${response.company.code}-cash-flow`, response.period), body: cashFlowCsv(response) };
  }

  source(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, (client, user) => readSourceView(this.registry, client, booksCtx(this.access, client, workspaceId, user), query));
  }

  setSource(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, (client, user) => setStatementSource(this.registry, client, booksCtx(this.access, client, workspaceId, user), body));
  }
}
