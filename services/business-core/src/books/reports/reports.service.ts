import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { BOOKS_PERMISSIONS } from "../books-contract";
import { BOOKS_SWEEP, type BooksSweepPort } from "./books-sweep.port";
import { readAccountLedger, readAccounts, readCompanyReport, readJournal, readJournals, readOverview } from "./ledger-reports";
import { accountsCsv, csvFileName, journalsCsv, reportCsv } from "./report-csv";

export type CsvFile = { fileName: string; body: string };

/** The Ledger area's reads (books.view), each after an on-demand posting sweep, inside the member's tenant transaction. */
@Injectable()
export class BooksReportsService {
  private readonly logger = new Logger(BooksReportsService.name);

  constructor(
    private readonly access: WorkspaceAccessService,
    @Optional() @Inject(BOOKS_SWEEP) private readonly sweep?: BooksSweepPort,
  ) {}

  /**
   * Call site of the on-demand sweep (plan §6.21b "it also runs on demand before any Ledger read"). A sweep that fails
   * never blocks a read: the 30-second sweep retries, and the attention list shows what could not post.
   */
  private async sweepBeforeRead(workspaceId: string) {
    if (!this.sweep) return;
    try {
      await this.sweep.runSweepNow(workspaceId);
    } catch (error) {
      this.logger.warn(`Ledger sweep before read failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async read<T>(actor: RequestActor, workspaceId: string, work: (client: PoolClient, user: ActorUser) => Promise<T>): Promise<T> {
    await this.sweepBeforeRead(workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.view, work);
  }

  overview(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.read(actor, workspaceId, async (client, user) => {
      const granted = await this.access.grantedPermissions(client, workspaceId, user.userId, [BOOKS_PERMISSIONS.manage, BOOKS_PERMISSIONS.post]);
      return readOverview(client, workspaceId, query, { canManage: granted.has(BOOKS_PERMISSIONS.manage), canPost: granted.has(BOOKS_PERMISSIONS.post) });
    });
  }

  report(actor: RequestActor, workspaceId: string, code: string, query: Record<string, unknown>) {
    return this.read(actor, workspaceId, (client) => readCompanyReport(client, workspaceId, code, query));
  }

  async reportFile(actor: RequestActor, workspaceId: string, code: string, query: Record<string, unknown>): Promise<CsvFile> {
    const report = await this.report(actor, workspaceId, code, query);
    const name = report.report === "general-ledger" ? `general-ledger-${report.account.code}` : report.report;
    return { fileName: csvFileName(`${report.entity.code}-${name}`, report.scope), body: reportCsv(report) };
  }

  accounts(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.read(actor, workspaceId, (client) => readAccounts(client, workspaceId, query));
  }

  async accountsFile(actor: RequestActor, workspaceId: string, query: Record<string, unknown>): Promise<CsvFile> {
    const list = await this.accounts(actor, workspaceId, query);
    return { fileName: csvFileName(`${list.entity.code}-accounts`, list.scope), body: accountsCsv(list) };
  }

  account(actor: RequestActor, workspaceId: string, accountId: string, query: Record<string, unknown>) {
    return this.read(actor, workspaceId, (client) => readAccountLedger(client, workspaceId, accountId, query));
  }

  async accountFile(actor: RequestActor, workspaceId: string, accountId: string, query: Record<string, unknown>): Promise<CsvFile> {
    const report = await this.account(actor, workspaceId, accountId, query);
    return { fileName: csvFileName(`${report.entity.code}-general-ledger-${report.account.code}`, report.scope), body: reportCsv(report) };
  }

  journals(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.read(actor, workspaceId, (client) => readJournals(client, workspaceId, query));
  }

  async journalsFile(actor: RequestActor, workspaceId: string, query: Record<string, unknown>): Promise<CsvFile> {
    const list = await this.journals(actor, workspaceId, { ...query, limit: 1000 });
    return { fileName: csvFileName(`${list.entity.code}-journals`, list.scope), body: journalsCsv(list) };
  }

  journal(actor: RequestActor, workspaceId: string, journalId: string) {
    return this.read(actor, workspaceId, (client) => readJournal(client, workspaceId, journalId));
  }
}
