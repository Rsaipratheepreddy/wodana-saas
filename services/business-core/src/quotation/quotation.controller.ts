import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { QuotationBuilderService } from "./quotation-builder.service";

/** The quotation builder, its settings and the firm's work packages (plan §6.8). Bodies are validated in the service. */
@ApiTags("quotation")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/quotation")
export class QuotationController {
  constructor(private readonly builder: QuotationBuilderService) {}

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.builder.settings(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.builder.saveSettings(actor, workspaceId, input ?? {}); }

  @Post("work-packages")
  addWorkPackage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: { id?: string; name?: string }) { return this.builder.addWorkPackage(actor, workspaceId, input ?? {}); }

  @Patch("work-packages/:id")
  updateWorkPackage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: { name?: string; archived?: boolean }) { return this.builder.updateWorkPackage(actor, workspaceId, id, input ?? {}); }

  @Get("cases/:caseId/quotes/:quoteId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string) { return this.builder.builder(actor, workspaceId, caseId, quoteId); }

  @Get("cases/:caseId/quotes/:quoteId/catalog")
  search(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string, @Query("q") query = "") { return this.builder.search(actor, workspaceId, caseId, quoteId, String(query)); }

  @Post("cases/:caseId/quotes/:quoteId/lines")
  apply(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string, @Body() input: { ops?: unknown }) { return this.builder.apply(actor, workspaceId, caseId, quoteId, input ?? {}); }

  @Put("cases/:caseId/quotes/:quoteId/discounts")
  discount(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string, @Body() input: Record<string, unknown>) { return this.builder.setDiscount(actor, workspaceId, caseId, quoteId, input ?? {}); }

  @Put("cases/:caseId/quotes/:quoteId/payment-terms")
  paymentTerms(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string, @Body() input: { terms?: unknown }) { return this.builder.setPaymentTerms(actor, workspaceId, caseId, quoteId, input ?? {}); }

  @Put("cases/:caseId/quotes/:quoteId/tax")
  tax(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quoteId: string, @Body() input: { taxRate?: unknown }) { return this.builder.setQuoteTax(actor, workspaceId, caseId, quoteId, input ?? {}); }
}
