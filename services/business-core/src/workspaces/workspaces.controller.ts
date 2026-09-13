import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { CreateIntegrationConnectionDto } from "../integrations/dto/create-integration-connection.dto";
import { UpdateIntegrationConnectionDto } from "../integrations/dto/update-integration-connection.dto";
import { AcceptInvitationDto } from "./dto/accept-invitation.dto";
import { CreateBusinessUnitDto } from "./dto/create-business-unit.dto";
import { CreateTeamDto } from "./dto/create-team.dto";
import { CreateLegalEntityDto } from "./dto/create-legal-entity.dto";
import { CreateRoleDto } from "./dto/create-role.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ListAuditEventsQueryDto } from "./dto/list-audit-events-query.dto";
import { UpdateBusinessUnitDto } from "./dto/update-business-unit.dto";
import { UpdateTeamDto } from "./dto/update-team.dto";
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto";
import { UpdateLegalEntityDto } from "./dto/update-legal-entity.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { UpdateWorkspaceSettingsDto } from "./dto/update-workspace-settings.dto";
import { UpdateWorkspaceTerminologyDto } from "./dto/update-workspace-terminology.dto";
import { CompleteOnboardingDto, UpdateOnboardingDto } from "./dto/update-onboarding.dto";
import { VersionDto } from "./dto/version.dto";
import {
  AuditPageResponseDto,
  BusinessUnitResponseDto,
  CancelledInvitationResponseDto,
  CreatedInvitationResponseDto,
  CreateWorkspaceResponseDto,
  DeletedRoleResponseDto,
  IntegrationConnectionResponseDto,
  InvitationAcceptanceResponseDto,
  LegalEntityResponseDto,
  ListedInvitationResponseDto,
  ResentInvitationResponseDto,
  RoleResponseDto,
  WorkspaceDetailResponseDto,
  WorkspaceMemberResponseDto,
  WorkspaceResponseDto,
  WorkspaceOnboardingResponseDto,
  CompanyProfileUpdateResponseDto,
  WorkspaceTeamResponseDto,
  WorkspaceTerminologyResponseDto,
  WorkspaceTerminologyItemResponseDto,
} from "./dto/workspace-response.dto";
import { WorkspacesService } from "./workspaces.service";
import { InitiateCompanyLogoUploadDto } from "./dto/company-logo.dto";
import type { Request } from "express";

@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  @ApiOperation({ summary: "Create a workspace and its first legal entity" })
  @ApiCreatedResponse({ type: CreateWorkspaceResponseDto })
  create(@CurrentActor() actor: RequestActor, @Body() input: CreateWorkspaceDto) {
    return this.workspaces.create(actor, input);
  }

  @Get()
  @ApiOperation({ summary: "List workspaces available to the current user" })
  @ApiOkResponse({ type: WorkspaceResponseDto, isArray: true })
  list(@CurrentActor() actor: RequestActor) {
    return this.workspaces.list(actor);
  }

  @Post("invitations/accept")
  @ApiOperation({ summary: "Accept a workspace invitation" })
  @ApiCreatedResponse({ type: InvitationAcceptanceResponseDto })
  acceptInvitation(
    @CurrentActor() actor: RequestActor,
    @Body() input: AcceptInvitationDto,
  ) {
    return this.workspaces.acceptInvitation(actor, input.token);
  }

  @Post("invitations/:invitationId/accept")
  @ApiOperation({ summary: "Accept an invitation discovered for the verified user email" })
  @ApiCreatedResponse({ type: InvitationAcceptanceResponseDto })
  acceptInvitationById(
    @CurrentActor() actor: RequestActor,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaces.acceptInvitationById(actor, invitationId);
  }

  @Get(":workspaceId")
  @ApiOperation({ summary: "Get workspace organization settings" })
  @ApiOkResponse({ type: WorkspaceDetailResponseDto })
  get(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.get(actor, workspaceId);
  }

  @Patch(":workspaceId/company-profile")
  @ApiOperation({ summary: "Update workspace and legal company identity atomically" })
  @ApiOkResponse({ type: CompanyProfileUpdateResponseDto })
  updateCompanyProfile(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: UpdateCompanyProfileDto,
  ) {
    return this.workspaces.updateCompanyProfile(actor, workspaceId, input);
  }

  @Post(":workspaceId/company-profile/logo-uploads")
  @ApiOperation({ summary: "Create a short-lived company-logo upload" })
  @ApiCreatedResponse()
  initiateCompanyLogoUpload(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: InitiateCompanyLogoUploadDto,
  ) {
    return this.workspaces.initiateCompanyLogoUpload(actor, workspaceId, input);
  }

  @Post(":workspaceId/company-profile/logo-uploads/:assetId/complete")
  @ApiOperation({ summary: "Verify and activate an uploaded company logo" })
  @ApiCreatedResponse()
  completeCompanyLogoUpload(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    return this.workspaces.completeCompanyLogoUpload(actor, workspaceId, assetId);
  }

  @Post(":workspaceId/company-profile/logo-uploads/:assetId/content")
  @ApiOperation({ summary: "Upload logo content when local application storage is enabled" })
  @ApiCreatedResponse()
  async uploadCompanyLogoContent(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Req() request: Request,
  ) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > 5 * 1024 * 1024) throw new Error("Logo must be 5 MB or smaller");
      chunks.push(buffer);
    }
    return this.workspaces.uploadCompanyLogoContent(
      actor,
      workspaceId,
      assetId,
      String(request.headers["content-type"] ?? "").split(";")[0],
      Buffer.concat(chunks),
    );
  }

  @Delete(":workspaceId/company-profile/logo")
  @ApiOperation({ summary: "Remove the active company logo" })
  @ApiOkResponse()
  removeCompanyLogo(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.removeCompanyLogo(actor, workspaceId);
  }

  @Get(":workspaceId/onboarding")
  @ApiOperation({ summary: "Load resumable workspace onboarding state" })
  @ApiOkResponse({ type: WorkspaceOnboardingResponseDto })
  getOnboarding(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.getOnboarding(actor, workspaceId);
  }

  @Patch(":workspaceId/onboarding")
  @ApiOperation({ summary: "Advance resumable workspace onboarding" })
  @ApiOkResponse({ type: WorkspaceOnboardingResponseDto })
  updateOnboarding(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: UpdateOnboardingDto,
  ) {
    return this.workspaces.updateOnboarding(actor, workspaceId, input);
  }

  @Post(":workspaceId/onboarding/complete")
  @ApiOperation({ summary: "Complete required onboarding and enter the workspace" })
  @ApiCreatedResponse({ type: WorkspaceOnboardingResponseDto })
  completeOnboarding(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CompleteOnboardingDto,
  ) {
    return this.workspaces.completeOnboarding(actor, workspaceId, input);
  }

  @Patch(":workspaceId")
  @ApiOperation({ summary: "Update workspace identity" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  updateWorkspace(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: UpdateWorkspaceDto,
  ) {
    return this.workspaces.updateWorkspace(actor, workspaceId, input);
  }

  @Patch(":workspaceId/settings")
  @ApiOperation({ summary: "Update workspace regional settings" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  updateSettings(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: UpdateWorkspaceSettingsDto,
  ) {
    return this.workspaces.updateSettings(actor, workspaceId, input);
  }

  @Get(":workspaceId/terminology")
  @ApiOperation({ summary: "Get resolved tenant terminology" })
  @ApiOkResponse({ type: WorkspaceTerminologyResponseDto })
  terminology(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.terminology(actor, workspaceId);
  }

  @Put(":workspaceId/terminology/:key")
  @ApiOperation({ summary: "Create or update one tenant terminology override" })
  @ApiOkResponse({ type: WorkspaceTerminologyItemResponseDto })
  updateTerminology(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("key") key: string,
    @Body() input: UpdateWorkspaceTerminologyDto,
  ) {
    return this.workspaces.updateTerminology(actor, workspaceId, key, input);
  }

  @Delete(":workspaceId/terminology/:key")
  @ApiOperation({ summary: "Restore one tenant terminology value to its default" })
  @ApiOkResponse({ type: WorkspaceTerminologyItemResponseDto })
  restoreTerminology(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("key") key: string,
    @Query("version", ParseIntPipe) version: number,
  ) {
    return this.workspaces.restoreTerminology(actor, workspaceId, key, version);
  }

  @Post(":workspaceId/legal-entities")
  @ApiOperation({ summary: "Create a legal entity" })
  @ApiCreatedResponse({ type: LegalEntityResponseDto })
  createLegalEntity(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateLegalEntityDto,
  ) {
    return this.workspaces.createLegalEntity(actor, workspaceId, input);
  }

  @Patch(":workspaceId/legal-entities/:entityId")
  @ApiOperation({ summary: "Update a legal entity" })
  @ApiOkResponse({ type: LegalEntityResponseDto })
  updateLegalEntity(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("entityId", ParseUUIDPipe) entityId: string,
    @Body() input: UpdateLegalEntityDto,
  ) {
    return this.workspaces.updateLegalEntity(actor, workspaceId, entityId, input);
  }

  @Post(":workspaceId/legal-entities/:entityId/archive")
  @ApiOperation({ summary: "Archive an unused legal entity" })
  @ApiCreatedResponse({ type: LegalEntityResponseDto })
  archiveLegalEntity(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("entityId", ParseUUIDPipe) entityId: string,
    @Body() input: VersionDto,
  ) {
    return this.workspaces.archiveLegalEntity(actor, workspaceId, entityId, input.version);
  }

  @Post(":workspaceId/business-units")
  @ApiOperation({ summary: "Create a studio, branch, or operating unit" })
  @ApiCreatedResponse({ type: BusinessUnitResponseDto })
  createBusinessUnit(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateBusinessUnitDto,
  ) {
    return this.workspaces.createBusinessUnit(actor, workspaceId, input);
  }

  @Patch(":workspaceId/business-units/:unitId")
  @ApiOperation({ summary: "Update a business unit" })
  @ApiOkResponse({ type: BusinessUnitResponseDto })
  updateBusinessUnit(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body() input: UpdateBusinessUnitDto,
  ) {
    return this.workspaces.updateBusinessUnit(actor, workspaceId, unitId, input);
  }

  @Post(":workspaceId/business-units/:unitId/archive")
  @ApiOperation({ summary: "Archive a business unit" })
  @ApiCreatedResponse({ type: BusinessUnitResponseDto })
  archiveBusinessUnit(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body() input: VersionDto,
  ) {
    return this.workspaces.archiveBusinessUnit(actor, workspaceId, unitId, input.version);
  }

  @Get(":workspaceId/teams")
  @ApiOperation({ summary: "List workspace teams and assigned members" })
  @ApiOkResponse({ type: WorkspaceTeamResponseDto, isArray: true })
  listTeams(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.listTeams(actor, workspaceId);
  }

  @Post(":workspaceId/teams")
  @ApiOperation({ summary: "Create a team under a business unit" })
  @ApiCreatedResponse({ type: WorkspaceTeamResponseDto })
  createTeam(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateTeamDto,
  ) {
    return this.workspaces.createTeam(actor, workspaceId, input);
  }

  @Patch(":workspaceId/teams/:teamId")
  @ApiOperation({ summary: "Update a team and its members" })
  @ApiOkResponse({ type: WorkspaceTeamResponseDto })
  updateTeam(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Body() input: UpdateTeamDto,
  ) {
    return this.workspaces.updateTeam(actor, workspaceId, teamId, input);
  }

  @Post(":workspaceId/teams/:teamId/archive")
  @ApiOperation({ summary: "Archive a team" })
  @ApiCreatedResponse({ type: WorkspaceTeamResponseDto })
  archiveTeam(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Body() input: VersionDto,
  ) {
    return this.workspaces.archiveTeam(actor, workspaceId, teamId, input.version);
  }

  @Get(":workspaceId/roles")
  @ApiOperation({ summary: "List workspace roles and permissions" })
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  listRoles(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.listRoles(actor, workspaceId);
  }

  @Post(":workspaceId/roles")
  @ApiOperation({ summary: "Create a custom workspace role" })
  @ApiCreatedResponse({ type: RoleResponseDto })
  createRole(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateRoleDto,
  ) {
    return this.workspaces.createRole(actor, workspaceId, input);
  }

  @Patch(":workspaceId/roles/:roleId")
  @ApiOperation({ summary: "Update a custom workspace role" })
  @ApiOkResponse({ type: RoleResponseDto })
  updateRole(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Body() input: UpdateRoleDto,
  ) {
    return this.workspaces.updateRole(actor, workspaceId, roleId, input);
  }

  @Delete(":workspaceId/roles/:roleId")
  @ApiOperation({ summary: "Delete an unused custom workspace role" })
  @ApiOkResponse({ type: DeletedRoleResponseDto })
  deleteRole(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Query("version", ParseIntPipe) version: number,
  ) {
    return this.workspaces.deleteRole(actor, workspaceId, roleId, version);
  }

  @Get(":workspaceId/members")
  @ApiOperation({ summary: "List workspace members" })
  @ApiOkResponse({ type: WorkspaceMemberResponseDto, isArray: true })
  listMembers(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.listMembers(actor, workspaceId);
  }

  @Patch(":workspaceId/members/:membershipId")
  @ApiOperation({ summary: "Change member roles or activation status" })
  @ApiOkResponse({ type: WorkspaceMemberResponseDto })
  updateMember(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
    @Body() input: UpdateMemberDto,
  ) {
    return this.workspaces.updateMember(actor, workspaceId, membershipId, input);
  }

  @Post(":workspaceId/invitations")
  @ApiOperation({ summary: "Invite a member and assign workspace roles" })
  @ApiCreatedResponse({ type: CreatedInvitationResponseDto })
  inviteMember(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: InviteMemberDto,
  ) {
    return this.workspaces.inviteMember(actor, workspaceId, input);
  }

  @Get(":workspaceId/invitations")
  @ApiOperation({ summary: "List workspace invitations" })
  @ApiOkResponse({ type: ListedInvitationResponseDto, isArray: true })
  listInvitations(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.listInvitations(actor, workspaceId);
  }

  @Delete(":workspaceId/invitations/:invitationId")
  @ApiOperation({ summary: "Cancel a pending invitation" })
  @ApiOkResponse({ type: CancelledInvitationResponseDto })
  cancelInvitation(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaces.cancelInvitation(actor, workspaceId, invitationId);
  }

  @Post(":workspaceId/invitations/:invitationId/resend")
  @ApiOperation({ summary: "Rotate and resend a pending invitation" })
  @ApiCreatedResponse({ type: ResentInvitationResponseDto })
  resendInvitation(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ) {
    return this.workspaces.resendInvitation(actor, workspaceId, invitationId);
  }

  @Get(":workspaceId/integration-connections")
  @ApiOperation({ summary: "List workspace integration connections" })
  @ApiOkResponse({ type: IntegrationConnectionResponseDto, isArray: true })
  listIntegrationConnections(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.listIntegrationConnections(actor, workspaceId);
  }

  @Post(":workspaceId/integration-connections")
  @ApiOperation({ summary: "Register a draft integration connection" })
  @ApiCreatedResponse({ type: IntegrationConnectionResponseDto })
  createIntegrationConnection(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateIntegrationConnectionDto,
  ) {
    return this.workspaces.createIntegrationConnection(actor, workspaceId, input);
  }

  @Patch(":workspaceId/integration-connections/:connectionId")
  @ApiOperation({ summary: "Update integration connection settings" })
  @ApiOkResponse({ type: IntegrationConnectionResponseDto })
  updateIntegrationConnection(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: UpdateIntegrationConnectionDto,
  ) {
    return this.workspaces.updateIntegrationConnection(actor, workspaceId, connectionId, input);
  }

  @Post(":workspaceId/integration-connections/:connectionId/connect")
  @ApiOperation({ summary: "Request provider connection or reconnection" })
  @ApiCreatedResponse({ type: IntegrationConnectionResponseDto })
  requestIntegrationConnection(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: VersionDto,
  ) {
    return this.workspaces.requestIntegrationConnection(
      actor,
      workspaceId,
      connectionId,
      input.version,
    );
  }

  @Delete(":workspaceId/integration-connections/:connectionId")
  @ApiOperation({ summary: "Revoke an integration connection" })
  @ApiOkResponse({ type: IntegrationConnectionResponseDto })
  revokeIntegrationConnection(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Query("version", ParseIntPipe) version: number,
  ) {
    return this.workspaces.revokeIntegrationConnection(
      actor,
      workspaceId,
      connectionId,
      version,
    );
  }

  @Get(":workspaceId/audit-events")
  @ApiOperation({ summary: "List immutable workspace audit events" })
  @ApiOkResponse({ type: AuditPageResponseDto })
  listAuditEvents(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ListAuditEventsQueryDto,
  ) {
    return this.workspaces.listAuditEvents(actor, workspaceId, query.limit, query.cursor);
  }
}
