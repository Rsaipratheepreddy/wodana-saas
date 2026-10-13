import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmLeadsService } from "./crm-leads.service";
import { CrmSalesAttentionService } from "./crm-sales-attention.service";
import {
  AddQueueMemberDto,
  AssignLeadDto,
  CreateAssignmentPolicyDto,
  CreateQueueDto,
  CreateSlaPolicyDto,
  ListLeadsQueryDto,
  ProcessSlaDto,
  ContactMatchQueryDto,
  ConfirmClientDto,
  ReopenDuplicateDto,
  UpdateSalesSettingsDto,
  TransitionLeadDto,
  LeadVersionDto,
  LogContactDto,
  UpdateAssignmentPolicyDto,
  UpdateQueueDto,
  UpdateSlaPolicyDto,
  UpsertQualificationDto,
} from "./dto/leads.dto";

@ApiTags("crm-leads")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmLeadsController {
  constructor(private readonly leads: CrmLeadsService) {}

  @Get("leads")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListLeadsQueryDto) {
    return this.leads.list(actor, workspaceId, query);
  }

  @Get("leads/contact-match")
  contactMatch(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ContactMatchQueryDto) {
    return this.leads.contactMatch(actor, workspaceId, query);
  }

  @Get("sales-settings")
  salesSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.leads.salesSettings(actor, workspaceId);
  }

  @Patch("sales-settings")
  updateSalesSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: UpdateSalesSettingsDto) {
    return this.leads.updateSalesSettings(actor, workspaceId, input);
  }

  @Post("leads/:leadId/confirm-client")
  confirmClient(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: ConfirmClientDto) {
    return this.leads.confirmClient(actor, workspaceId, leadId, input);
  }

  @Post("leads/:leadId/reopen-duplicate")
  reopenDuplicate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: ReopenDuplicateDto) {
    return this.leads.reopenDuplicate(actor, workspaceId, leadId, input);
  }

  @Get("leads/:leadId/history")
  history(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string) {
    return this.leads.history(actor, workspaceId, leadId);
  }

  @Get("leads/:leadId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string) {
    return this.leads.get(actor, workspaceId, leadId);
  }

  @Get("sales-owners")
  salesOwners(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("queueId") queueId?: string) {
    return this.leads.salesOwners(actor, workspaceId, queueId);
  }

  @Post("queues")
  createQueue(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateQueueDto) {
    return this.leads.createQueue(actor, workspaceId, input);
  }

  @Get("queues")
  listQueues(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.leads.listQueues(actor, workspaceId);
  }

  @Patch("queues/:queueId")
  updateQueue(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("queueId", ParseUUIDPipe) queueId: string, @Body() input: UpdateQueueDto) {
    return this.leads.updateQueue(actor, workspaceId, queueId, input);
  }

  @Put("queues/:queueId/members")
  addQueueMember(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("queueId", ParseUUIDPipe) queueId: string, @Body() input: AddQueueMemberDto) {
    return this.leads.addQueueMember(actor, workspaceId, queueId, input);
  }

  @Post("queues/:queueId/default-managers")
  addDefaultManagers(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("queueId", ParseUUIDPipe) queueId: string) {
    return this.leads.addDefaultManagers(actor, workspaceId, queueId);
  }

  @Delete("queues/:queueId/members/:membershipId")
  removeQueueMember(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("queueId", ParseUUIDPipe) queueId: string, @Param("membershipId", ParseUUIDPipe) membershipId: string) {
    return this.leads.removeQueueMember(actor, workspaceId, queueId, membershipId);
  }

  @Post("assignment-policies")
  createAssignmentPolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateAssignmentPolicyDto) {
    return this.leads.createAssignmentPolicy(actor, workspaceId, input);
  }

  @Get("assignment-policies")
  listAssignmentPolicies(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.leads.listAssignmentPolicies(actor, workspaceId);
  }

  @Patch("assignment-policies/:policyId")
  updateAssignmentPolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("policyId", ParseUUIDPipe) policyId: string, @Body() input: UpdateAssignmentPolicyDto) {
    return this.leads.updateAssignmentPolicy(actor, workspaceId, policyId, input);
  }

  @Post("sla-policies")
  createSlaPolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateSlaPolicyDto) {
    return this.leads.createSlaPolicy(actor, workspaceId, input);
  }

  @Get("sla-policies")
  listSlaPolicies(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.leads.listSlaPolicies(actor, workspaceId);
  }

  @Patch("sla-policies/:policyId")
  updateSlaPolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("policyId", ParseUUIDPipe) policyId: string, @Body() input: UpdateSlaPolicyDto) {
    return this.leads.updateSlaPolicy(actor, workspaceId, policyId, input);
  }

  @Post("leads/:leadId/assignment-simulation")
  simulate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string) {
    return this.leads.simulateAssignment(actor, workspaceId, leadId);
  }

  @Post("leads/:leadId/auto-assign")
  autoAssign(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Query("version", ParseIntPipe) version: number) {
    return this.leads.autoAssign(actor, workspaceId, leadId, version);
  }

  @Post("leads/:leadId/assign")
  assign(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: AssignLeadDto) {
    return this.leads.manualAssign(actor, workspaceId, leadId, input);
  }

  @Post("leads/:leadId/contacts")
  logContact(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: LogContactDto) {
    return this.leads.logContact(actor, workspaceId, leadId, input);
  }

  @Post("leads/:leadId/status")
  transition(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: TransitionLeadDto) {
    return this.leads.transition(actor, workspaceId, leadId, input);
  }

  /** Junk (S-13, PLM-138): closed as spam, out of reports, and its contact flagged as spam. */
  @Post("leads/:leadId/spam")
  markSpam(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: LeadVersionDto) {
    return this.leads.markSpam(actor, workspaceId, leadId, input);
  }

  /** PLM-138: "Not spam", with a reason: the contact is a real client again and its spam enquiries go back into the flow. */
  @Post("leads/:leadId/unspam")
  unmarkSpam(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: ReopenDuplicateDto) {
    return this.leads.unmarkSpam(actor, workspaceId, leadId, input);
  }

  @Put("leads/:leadId/qualification")
  qualification(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: UpsertQualificationDto) {
    return this.leads.upsertQualification(actor, workspaceId, leadId, input);
  }
}

@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/crm/slas")
export class InternalCrmSlasController {
  constructor(private readonly leads: CrmLeadsService, private readonly attention: CrmSalesAttentionService) {}

  @Post("workspaces/:workspaceId/process")
  process(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: ProcessSlaDto,
  ) {
    return this.leads.processDueSlasInternal(workspaceId, input.limit);
  }

  @Post("workspaces/:workspaceId/process-takeovers")
  async processTakeovers(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: ProcessSlaDto,
  ) {
    // The worker already calls this each pass; the other Sales timers (unowned, client review, come-back, digest) ride along.
    const takeovers = await this.leads.processDueTakeoversInternal(workspaceId, input.limit);
    const attention = await this.attention.processDueAttentionInternal(workspaceId, input.limit);
    return { ...takeovers, attention };
  }
}
