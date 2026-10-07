import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { BooksPostingService } from "./posting.service";

/** The Ledger's attention list: events that couldn't post yet, and trying one again. */
@ApiTags("books")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books/issues")
export class BooksPostingController {
  constructor(private readonly posting: BooksPostingService) {}

  @Get()
  issues(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.posting.issues(actor, workspaceId);
  }

  @Post(":issueId/retry")
  retry(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("issueId", ParseUUIDPipe) issueId: string) {
    return this.posting.retry(actor, workspaceId, issueId);
  }
}
