import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmScheduledMessagesService } from "./crm-scheduled-messages.service";
import { CreateScheduledMessageDto, ListMessagesQueryDto, SimulateWhatsAppDto, ProcessDueScheduledMessagesDto, ScheduledMessageVersionDto, UpdateScheduledMessageDto } from "./dto/conversations.dto";
import { CreateConversationDto, CreateMessageDto, CreateSequenceDto, EnrollSequenceDto, ListConversationsQueryDto, MessageReceiptDto, ProcessDueSequencesDto, ProviderInboundMessageDto, ProviderMessageReceiptDto, SequenceVersionDto, StopSequenceEnrollmentDto, UpdateSequenceDto, UpdateConversationDto } from "./dto/conversations.dto";

@ApiTags("crm-conversations") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmConversationsController {
  constructor(private readonly conversations: CrmConversationsService, private readonly scheduled: CrmScheduledMessagesService) {}
  @Post("conversations/:conversationId/scheduled-messages") schedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: CreateScheduledMessageDto) { return this.scheduled.create(actor, workspaceId, conversationId, input); }
  @Patch("conversations/:conversationId/scheduled-messages/:scheduledId") reschedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Param("scheduledId", ParseUUIDPipe) scheduledId: string, @Body() input: UpdateScheduledMessageDto) { return this.scheduled.update(actor, workspaceId, conversationId, scheduledId, input); }
  @Post("conversations/:conversationId/scheduled-messages/:scheduledId/cancel") cancelScheduled(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Param("scheduledId", ParseUUIDPipe) scheduledId: string, @Body() input: ScheduledMessageVersionDto) { return this.scheduled.cancel(actor, workspaceId, conversationId, scheduledId, input); }
  @Get("conversations") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListConversationsQueryDto) { return this.conversations.list(actor, workspaceId, query); }
  @Post("conversations/demo-whatsapp") simulateWhatsApp(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SimulateWhatsAppDto) { return this.conversations.simulateWhatsApp(actor, workspaceId, input); }
  @Post("conversations") create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateConversationDto) { return this.conversations.createConversation(actor, workspaceId, input); }
  @Get("conversations/:conversationId") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string) { return this.conversations.get(actor, workspaceId, conversationId); }
  @Patch("conversations/:conversationId") update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: UpdateConversationDto) { return this.conversations.updateConversation(actor, workspaceId, conversationId, input); }
  @Post("conversations/:conversationId/messages") message(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: CreateMessageDto) { return this.conversations.addMessage(actor, workspaceId, conversationId, input); }
  @Get("conversations/:conversationId/messages") messages(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Query() query: ListMessagesQueryDto) { return this.conversations.messages(actor, workspaceId, conversationId, query); }
  @Post("conversations/:conversationId/read") read(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string) { return this.conversations.markRead(actor, workspaceId, conversationId); }
  @Post("sequences") sequence(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateSequenceDto) { return this.conversations.createSequence(actor, workspaceId, input); }
  @Get("sequences") sequences(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.conversations.listSequences(actor, workspaceId); }
  @Patch("sequences/:sequenceId") updateSequence(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string, @Body() input: UpdateSequenceDto) { return this.conversations.updateSequence(actor, workspaceId, sequenceId, input); }
  @Post("sequences/:sequenceId/publish") publishSequence(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string, @Body() input: SequenceVersionDto) { return this.conversations.setSequenceStatus(actor, workspaceId, sequenceId, input, "active"); }
  @Post("sequences/:sequenceId/pause") pauseSequence(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string, @Body() input: SequenceVersionDto) { return this.conversations.setSequenceStatus(actor, workspaceId, sequenceId, input, "paused"); }
  @Post("sequences/:sequenceId/archive") archiveSequence(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string, @Body() input: SequenceVersionDto) { return this.conversations.archiveSequence(actor, workspaceId, sequenceId, input); }
  @Post("sequences/:sequenceId/enrollments") enroll(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string, @Body() input: EnrollSequenceDto) { return this.conversations.enrollSequence(actor, workspaceId, sequenceId, input); }
  @Get("sequences/:sequenceId/enrollments") enrollments(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sequenceId", ParseUUIDPipe) sequenceId: string) { return this.conversations.listSequenceEnrollments(actor, workspaceId, sequenceId); }
  @Post("sequence-enrollments/:enrollmentId/stop") stopEnrollment(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string, @Body() input: StopSequenceEnrollmentDto) { return this.conversations.stopSequenceEnrollment(actor, workspaceId, enrollmentId, input); }
}

@ApiExcludeController() @Public() @UseGuards(InternalServiceGuard)
@Controller("internal/crm")
export class InternalCrmConversationsController {
  constructor(private readonly conversations: CrmConversationsService, private readonly scheduled: CrmScheduledMessagesService) {}
  @Post("workspaces/:workspaceId/scheduled-messages/run") sendScheduled(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ProcessDueScheduledMessagesDto) { return this.scheduled.processDueInternal(workspaceId, input.limit); }
  @Post("workspaces/:workspaceId/conversations/:conversationId/inbound-messages") inbound(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() input: CreateMessageDto) { return this.conversations.addInboundInternal(workspaceId, conversationId, input); }
  @Post("messages/:messageId/receipt") receipt(@Param("messageId", ParseUUIDPipe) messageId: string, @Body() input: MessageReceiptDto) { return this.conversations.recordReceipt(messageId, input); }
  @Post("provider-messages") providerMessage(@Body() input: ProviderInboundMessageDto) { return this.conversations.ingestProviderMessage(input); }
  @Post("provider-echoes") providerEcho(@Body() input: ProviderInboundMessageDto) { return this.conversations.ingestProviderEcho(input); }
  @Post("provider-receipts") providerReceipt(@Body() input: ProviderMessageReceiptDto) { return this.conversations.recordProviderReceipt(input); }
  @Post("workspaces/:workspaceId/sequences/process") processSequences(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ProcessDueSequencesDto) { return this.conversations.processDueSequencesInternal(workspaceId, input.limit); }
}
