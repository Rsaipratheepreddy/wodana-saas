import { Body, Controller, Module, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ConversationSpamDto } from "../conversations/dto/conversations.dto";
import { CrmIntakeModule } from "../intake/crm-intake.module";
import { CrmLeadsModule } from "../leads/crm-leads.module";
import { CrmSpamService } from "./crm-spam.service";

@ApiTags("crm-spam") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmSpamController {
  constructor(private readonly spam: CrmSpamService) {}

  /** PLM-138: mark a chat as spam (its contact and enquiry too), or, with a reason, say it isn't. */
  @Put("conversations/:conversationId/spam")
  setChatSpam(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: ConversationSpamDto) {
    return this.spam.setChatSpam(actor, workspaceId, conversationId, input);
  }
}

@Module({
  imports: [WorkspacesModule, CrmLeadsModule, CrmIntakeModule],
  controllers: [CrmSpamController],
  providers: [CrmSpamService],
})
export class CrmSpamModule {}
