import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { ManualJournalsService } from "./manual-journals.service";

/** Manual and opening journals: the list, the editor's options, the opening file preview, one journal and its commands. */
@ApiTags("ledger")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books/manual-journals")
export class ManualJournalsController {
  constructor(private readonly journals: ManualJournalsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.journals.list(actor, workspaceId, query ?? {});
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.journals.command(actor, workspaceId, input ?? {});
  }

  @Get("options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.journals.options(actor, workspaceId, query ?? {});
  }

  @Post("opening-preview")
  previewOpening(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.journals.previewOpening(actor, workspaceId, input ?? {});
  }

  @Get(":journalId")
  detail(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("journalId", ParseUUIDPipe) journalId: string) {
    return this.journals.detail(actor, workspaceId, journalId);
  }
}
