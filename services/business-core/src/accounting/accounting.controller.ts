import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { Public } from "../auth/public.decorator";
import { AccountingService } from "./accounting.service";

/** Where each company posts to accounting and the postings. Bodies are validated in the service. */
@ApiTags("accounting")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/accounting")
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get()
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.accounting.settings(actor, workspaceId);
  }

  @Put("links")
  saveLink(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.accounting.saveLink(actor, workspaceId, input ?? {});
  }

  @Get("postings")
  postings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.accounting.postings(actor, workspaceId);
  }

  @Post("postings/:postingId/retry")
  retry(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("postingId", ParseUUIDPipe) postingId: string) {
    return this.accounting.retry(actor, workspaceId, postingId);
  }
}

/** The integration worker leases due postings and reports what the accounting system did. */
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/accounting/postings")
export class InternalAccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Post("claim")
  claim() {
    return this.accounting.claim();
  }

  @Post("result")
  result(@Body() input: unknown) {
    return this.accounting.result(input);
  }
}
