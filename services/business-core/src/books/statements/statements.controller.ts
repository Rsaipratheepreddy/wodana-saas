import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { type CsvFile, BooksStatementsService } from "./statements.service";

const csv = (file: CsvFile) => new StreamableFile(Buffer.from(`﻿${file.body}`, "utf8"),
  { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${file.fileName}"` });

/**
 * Company statements: the P&L (`entity`, `from`, `to`, `basis`, `compare`) and the cash flow by month (`entity`,
 * `from`, `to`), each also as CSV (`format=csv`); where a company's statements come from, and choosing it.
 */
@ApiTags("ledger")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books/statements")
export class BooksStatementsController {
  constructor(private readonly statements: BooksStatementsService) {}

  @Get("profit-and-loss")
  @Header("Cache-Control", "private, no-store")
  async profitAndLoss(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return query?.format === "csv" ? csv(await this.statements.profitAndLossFile(actor, workspaceId, query)) : this.statements.profitAndLoss(actor, workspaceId, query ?? {});
  }

  @Get("cash-flow")
  @Header("Cache-Control", "private, no-store")
  async cashFlow(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return query?.format === "csv" ? csv(await this.statements.cashFlowFile(actor, workspaceId, query)) : this.statements.cashFlow(actor, workspaceId, query ?? {});
  }

  @Get("source")
  source(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.statements.source(actor, workspaceId, query ?? {});
  }

  @Post("source")
  setSource(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.statements.setSource(actor, workspaceId, body ?? {});
  }
}
