import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { AiSuggestionsService } from "./ai-suggestions.service";
import { CreateAiSuggestionDto, DecideAiSuggestionDto } from "./dto/ai-suggestions.dto";

@ApiTags("ai-suggestions")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/ai-suggestions")
export class AiSuggestionsController {
  constructor(private readonly suggestions: AiSuggestionsService) {}

  @Post()
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateAiSuggestionDto) {
    return this.suggestions.create(actor, workspaceId, input);
  }

  @Patch(":id/decision")
  decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: DecideAiSuggestionDto) {
    return this.suggestions.decide(actor, workspaceId, id, input);
  }
}
