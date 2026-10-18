import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ReceivablesService } from "./receivables.service";

/** Tax invoices to clients for projects' payment milestones, and credit notes. Bodies are validated in the service. */
@ApiTags("receivables")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/receivables")
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.receivables.overview(actor, workspaceId);
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.receivables.command(actor, workspaceId, input ?? {});
  }

  @Get("invoices/:invoiceId")
  invoice(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("invoiceId", ParseUUIDPipe) invoiceId: string) {
    return this.receivables.invoice(actor, workspaceId, invoiceId);
  }

  @Get("milestones/:caseId/:paymentId")
  preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("paymentId") paymentId: string) {
    return this.receivables.preview(actor, workspaceId, caseId, paymentId);
  }
}
