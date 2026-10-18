import { Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { type CsvFile, BooksReportsService } from "./reports.service";

const csv = (file: CsvFile) => new StreamableFile(Buffer.from(`﻿${file.body}`, "utf8"),
  { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${file.fileName}"` });
const wantsCsv = (query: Record<string, unknown> | undefined) => query?.format === "csv";

/**
 * The Ledger area (books.view): the overview, the company reports, the chart with balances, an account's ledger,
 * journals and one journal. Every read takes `entity`, `from` and `to`; `format=csv` returns the same figures as a file.
 */
@ApiTags("ledger")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books/reports")
export class BooksReportsController {
  constructor(private readonly reports: BooksReportsService) {}

  @Get("overview")
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.reports.overview(actor, workspaceId, query ?? {});
  }

  @Get("accounts")
  @Header("Cache-Control", "private, no-store")
  async accounts(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return wantsCsv(query) ? csv(await this.reports.accountsFile(actor, workspaceId, query)) : this.reports.accounts(actor, workspaceId, query ?? {});
  }

  @Get("accounts/:accountId")
  @Header("Cache-Control", "private, no-store")
  async account(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("accountId") accountId: string,
    @Query() query: Record<string, unknown>) {
    return wantsCsv(query) ? csv(await this.reports.accountFile(actor, workspaceId, accountId, query)) : this.reports.account(actor, workspaceId, accountId, query ?? {});
  }

  @Get("journals")
  @Header("Cache-Control", "private, no-store")
  async journals(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return wantsCsv(query) ? csv(await this.reports.journalsFile(actor, workspaceId, query)) : this.reports.journals(actor, workspaceId, query ?? {});
  }

  @Get("journals/:journalId")
  journal(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("journalId") journalId: string) {
    return this.reports.journal(actor, workspaceId, journalId);
  }

  @Get(":report")
  @Header("Cache-Control", "private, no-store")
  async report(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("report") report: string,
    @Query() query: Record<string, unknown>) {
    return wantsCsv(query) ? csv(await this.reports.reportFile(actor, workspaceId, report, query)) : this.reports.report(actor, workspaceId, report, query ?? {});
  }
}
