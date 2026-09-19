import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiSuggestionsController } from "./ai-suggestions.controller";
import { AiSuggestionsService } from "./ai-suggestions.service";

@Module({ imports: [WorkspacesModule], controllers: [AiSuggestionsController], providers: [AiSuggestionsService] })
export class AiSuggestionsModule {}
