import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmAutomationsService } from "./crm-automations.service";
import { AdvanceAutomationRunDto, ApprovalDecisionDto, AutomationVersionDto, ClaimWorkspaceDto, CompleteAutomationWaitDto, CreateAutomationDto, DryRunAutomationDto, ExecuteAutomationStepDto, ListAutomationRunsQueryDto, StartAutomationRunDto, UpdateAutomationDto, UpdateAutomationPresetDto } from "./dto/automations.dto";
@ApiTags("crm-automations") @ApiBearerAuth() @Controller("workspaces/:workspaceId/crm")
export class CrmAutomationsController {
  constructor(private readonly automations: CrmAutomationsService) {}
  @Get("automation-presets") presets(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.automations.presets(actor, workspaceId); }
  @Patch("automation-presets/:code") updatePreset(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("code") code: string, @Body() input: UpdateAutomationPresetDto) { return this.automations.updatePreset(actor, workspaceId, code, input); }
  @Get("automation-approvals") approvals(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.automations.approvals(actor, workspaceId); }
  @Get("automations") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.automations.list(actor, workspaceId); }
  @Get("automations/:id") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string) { return this.automations.get(actor, workspaceId, id); }
  @Post("automations") create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateAutomationDto) { return this.automations.create(actor, workspaceId, input); }
  @Patch("automations/:id") update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateAutomationDto) { return this.automations.update(actor, workspaceId, id, input); }
  @Post("automations/:id/validate") validate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string) { return this.automations.validate(actor, workspaceId, id); }
  @Post("automations/:id/dry-run") dryRun(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: DryRunAutomationDto) { return this.automations.dryRun(actor, workspaceId, id, input.context); }
  @Post("automations/:id/publish") publish(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: AutomationVersionDto) { return this.automations.publish(actor, workspaceId, id, input); }
  @Post("automations/:id/pause") pause(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: AutomationVersionDto) { return this.automations.pause(actor, workspaceId, id, input); }
  @Get("automation-runs") runs(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListAutomationRunsQueryDto) { return this.automations.runs(actor, workspaceId, query.definitionId); }
  @Post("automation-approvals/:id/decision") decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: ApprovalDecisionDto) { return this.automations.decide(actor, workspaceId, id, input); }
}
@ApiExcludeController() @Public() @UseGuards(InternalServiceGuard) @Controller("internal/crm/automations")
export class InternalCrmAutomationsController {
  constructor(private readonly automations: CrmAutomationsService) {}
  @Post(":definitionId/runs") start(@Param("definitionId", ParseUUIDPipe) id: string, @Body() input: StartAutomationRunDto) { return this.automations.startInternal(id, input); }
  @Post("runs/:runId/advance") advance(@Param("runId", ParseUUIDPipe) id: string, @Body() input: AdvanceAutomationRunDto) { return this.automations.advanceInternal(id, input); }
  @Post("runs/:runId/steps/execute") execute(@Param("runId", ParseUUIDPipe) id: string, @Body() input: ExecuteAutomationStepDto) { return this.automations.executeStepInternal(id, input); }
  @Post("waits/claim") claim(@Body() input: ClaimWorkspaceDto) { return this.automations.claimWaitsInternal(input); }
  @Post("waits/:waitId/complete") completeWait(@Param("waitId", ParseUUIDPipe) id: string, @Body() input: CompleteAutomationWaitDto) { return this.automations.completeWaitInternal(id, input); }
  @Get("workspaces/due") dueWorkspaces() { return this.automations.dueWorkspacesInternal(); }
  @Get("workspaces/:workspaceId/matches") matches(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("eventType") eventType: string) { return this.automations.matchingInternal(workspaceId, eventType); }
  @Get("workspaces/:workspaceId/runs/:runId") context(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("runId", ParseUUIDPipe) runId: string) { return this.automations.runContextInternal(workspaceId, runId); }
}
