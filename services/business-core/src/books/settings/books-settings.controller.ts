import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { BooksSettingsService } from "./books-settings.service";

/** Settings › Ledger: every company's state, one company's settings, and the settings commands. Bodies are validated in the module. */
@ApiTags("ledger")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books/settings")
export class BooksSettingsController {
  constructor(private readonly settings: BooksSettingsService) {}

  @Get()
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.settings.overview(actor, workspaceId);
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.settings.command(actor, workspaceId, input ?? {});
  }

  @Get(":legalEntityId")
  company(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("legalEntityId", ParseUUIDPipe) legalEntityId: string) {
    return this.settings.company(actor, workspaceId, legalEntityId);
  }
}
