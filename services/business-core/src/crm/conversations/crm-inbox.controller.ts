import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmWhatsAppTemplatesService } from "./crm-whatsapp-templates.service";
import { SubmitStarterPackDto, TemplateSubmittedDto, UpdateClientMessageDto, WhatsAppTemplateSyncDto } from "./dto/whatsapp-templates.dto";
import { BulkConversationsDto, CreateLabelDto, CreateQuickReplyDto, SetConversationLabelsDto, SetTemplateVariablesDto, UpdateInboxSettingsDto, UpdateLabelDto, UpdateQuickReplyDto, WakeSnoozedDto } from "./dto/inbox.dto";

type Ws = string;

@ApiTags("crm-inbox") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmInboxController {
  constructor(private readonly inbox: CrmInboxService, private readonly whatsappTemplates: CrmWhatsAppTemplatesService) {}
  @Get("inbox/starter-pack") starterPack(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.whatsappTemplates.starterPack(actor, workspaceId); }
  @Post("inbox/starter-pack") submitStarterPack(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Body() input: SubmitStarterPackDto) { return this.whatsappTemplates.submitStarterPack(actor, workspaceId, input); }
  @Get("inbox/client-messages") clientMessages(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.whatsappTemplates.clientMessages(actor, workspaceId); }
  @Put("inbox/client-messages/:event") setClientMessage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("event") event: string, @Body() input: UpdateClientMessageDto) { return this.whatsappTemplates.setClientMessage(actor, workspaceId, event, input); }
  @Get("inbox/summary") summary(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.summary(actor, workspaceId); }
  @Get("inbox/owners") owners(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.owners(actor, workspaceId); }
  @Post("inbox/bulk") bulk(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Body() input: BulkConversationsDto) { return this.inbox.bulk(actor, workspaceId, input); }
  @Get("inbox/settings") settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.settings(actor, workspaceId); }
  @Put("inbox/settings") updateSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Body() input: UpdateInboxSettingsDto) { return this.inbox.updateSettings(actor, workspaceId, input); }
  @Get("inbox/labels") labels(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.labels(actor, workspaceId); }
  @Post("inbox/labels") createLabel(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Body() input: CreateLabelDto) { return this.inbox.createLabel(actor, workspaceId, input); }
  @Patch("inbox/labels/:labelId") updateLabel(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("labelId", ParseUUIDPipe) labelId: string, @Body() input: UpdateLabelDto) { return this.inbox.updateLabel(actor, workspaceId, labelId, input); }
  @Get("inbox/quick-replies") quickReplies(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.quickReplies(actor, workspaceId); }
  @Post("inbox/quick-replies") createQuickReply(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Body() input: CreateQuickReplyDto) { return this.inbox.createQuickReply(actor, workspaceId, input); }
  @Patch("inbox/quick-replies/:replyId") updateQuickReply(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("replyId", ParseUUIDPipe) replyId: string, @Body() input: UpdateQuickReplyDto) { return this.inbox.updateQuickReply(actor, workspaceId, replyId, input); }
  @Get("inbox/templates") templates(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws) { return this.inbox.templates(actor, workspaceId); }
  @Put("inbox/templates/:templateId/variables") setTemplateVariables(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("templateId", ParseUUIDPipe) templateId: string, @Body() input: SetTemplateVariablesDto) { return this.inbox.setTemplateVariables(actor, workspaceId, templateId, input); }
  @Put("conversations/:conversationId/labels") setLabels(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: SetConversationLabelsDto) { return this.inbox.setConversationLabels(actor, workspaceId, conversationId, input); }
  @Get("conversations/:conversationId/context") context(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: Ws, @Param("conversationId", ParseUUIDPipe) conversationId: string) { return this.inbox.context(actor, workspaceId, conversationId); }
}

@ApiExcludeController() @Public() @UseGuards(InternalServiceGuard)
@Controller("internal/crm")
export class InternalCrmInboxController {
  constructor(private readonly inbox: CrmInboxService, private readonly templates: CrmWhatsAppTemplatesService) {}
  @Post("workspaces/:workspaceId/conversations/wake") wake(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: WakeSnoozedDto) { return this.inbox.wakeSnoozedInternal(workspaceId, input.limit); }
  @Post("workspaces/:workspaceId/whatsapp-templates/due") templateWork(@Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.templates.dueWorkInternal(workspaceId); }
  @Post("workspaces/:workspaceId/whatsapp-templates/sync") templateSync(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: WhatsAppTemplateSyncDto) { return this.templates.syncInternal(workspaceId, input); }
  @Post("workspaces/:workspaceId/whatsapp-templates/:templateId/submitted") templateSubmitted(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @Body() input: TemplateSubmittedDto) { return this.templates.submittedInternal(workspaceId, templateId, input); }
}
