import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class WorkspaceResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ example: "AED" }) defaultCurrency!: string;
  @ApiProperty({ example: "en-AE" }) defaultLocale!: string;
  @ApiProperty({ example: "Asia/Dubai" }) defaultTimezone!: string;
  @ApiProperty({ enum: ["metric", "imperial", "mixed"] }) unitSystem!: string;
  @ApiProperty({ minimum: 0, maximum: 6 }) weekStartsOn!: number;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) accountId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) accountName?: string | null;
  @ApiPropertyOptional() isDefaultOrganization?: boolean;
}

export class CustomerAccountSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ minimum: 1 }) organizationLimit!: number;
  @ApiProperty() isDefaultOrganization!: boolean;
}

export class LegalEntityResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() registeredName!: string;
  @ApiProperty({ example: "AE" }) countryCode!: string;
  @ApiProperty({ example: "AED" }) baseCurrency!: string;
  @ApiProperty({ example: "en-AE" }) locale!: string;
  @ApiProperty({ example: "Asia/Dubai" }) timezone!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) taxRegistrationNumber!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) registrationNumber!: string | null;
  @ApiProperty({ type: "object", additionalProperties: true }) address!: Record<string, unknown>;
  @ApiProperty() status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}

export class BusinessUnitResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) legalEntityId!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  parentBusinessUnitId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "Backward-compatible tenant-visible alias of name" })
  visibleName!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ example: "Asia/Dubai" }) timezone!: string;
  @ApiProperty({ example: "#64748B" }) color!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class WorkspaceTerminologyItemResponseDto {
  @ApiProperty() key!: string;
  @ApiProperty() defaultVisibleName!: string;
  @ApiProperty() defaultVisibleNamePlural!: string;
  @ApiProperty() visibleName!: string;
  @ApiProperty() visibleNamePlural!: string;
  @ApiProperty() overridden!: boolean;
  @ApiProperty({ minimum: 0 }) version!: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  updatedAt!: string | null;
}

export class WorkspaceTerminologyResponseDto {
  @ApiProperty({ type: [WorkspaceTerminologyItemResponseDto] })
  items!: WorkspaceTerminologyItemResponseDto[];
  @ApiProperty({ type: "object", additionalProperties: true })
  map!: Record<string, { visibleName: string; visibleNamePlural: string }>;
}

export class TeamMemberResponseDto {
  @ApiProperty({ format: "uuid" }) membershipId!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() isLead!: boolean;
}

export class WorkspaceTeamResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) businessUnitId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: [TeamMemberResponseDto] }) members!: TeamMemberResponseDto[];
}

export class CreateWorkspaceMembershipResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "owner" }) role!: string;
  @ApiProperty({ example: "active" }) status!: string;
}

export class CreateWorkspaceResponseDto {
  @ApiProperty({ type: CustomerAccountSummaryResponseDto })
  account!: CustomerAccountSummaryResponseDto;
  @ApiProperty({ type: WorkspaceResponseDto }) workspace!: WorkspaceResponseDto;
  @ApiProperty({ type: [LegalEntityResponseDto] }) legalEntities!: LegalEntityResponseDto[];
  @ApiProperty({ type: CreateWorkspaceMembershipResponseDto })
  membership!: CreateWorkspaceMembershipResponseDto;
}

export class WorkspaceDetailResponseDto {
  @ApiProperty({ type: WorkspaceResponseDto }) workspace!: WorkspaceResponseDto;
  @ApiProperty({ type: [LegalEntityResponseDto] }) legalEntities!: LegalEntityResponseDto[];
  @ApiProperty({ type: [BusinessUnitResponseDto] }) businessUnits!: BusinessUnitResponseDto[];
  @ApiProperty({ type: "object", additionalProperties: true })
  branding!: { logoAssetId: string | null; logoUrl: string | null; logoUpdatedAt: string | null; primaryColor: string | null };
  @ApiProperty({ type: "object", additionalProperties: true })
  terminology!: Record<string, { visibleName: string; visibleNamePlural: string }>;
}

export class WorkspaceAppearanceResponseDto {
  @ApiProperty({ type: WorkspaceResponseDto }) workspace!: WorkspaceResponseDto;
  @ApiPropertyOptional({ example: "#0B7F5D", type: String, nullable: true })
  primaryColor!: string | null;
}

export class CompanyProfileUpdateResponseDto {
  @ApiProperty({ type: WorkspaceResponseDto }) workspace!: WorkspaceResponseDto;
  @ApiProperty({ type: LegalEntityResponseDto }) legalEntity!: LegalEntityResponseDto;
}

export class InvitationAcceptanceResponseDto {
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ format: "uuid" }) membershipId!: string;
  @ApiProperty({ example: "active" }) status!: string;
}

export class WorkspaceOnboardingResponseDto {
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ enum: ["not_started", "in_progress", "completed"] }) status!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ["workspace_profile", "organization", "team", "integrations"],
  })
  currentStep!: string | null;
  @ApiProperty({
    type: [String],
    enum: ["workspace_profile", "organization", "team", "integrations"],
  })
  completedSteps!: string[];
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  startedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  completedAt!: string | null;
}

export class ProvisionedOwnerInvitationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ example: "owner" }) role!: string;
  @ApiProperty({ enum: ["pending", "accepted", "cancelled", "expired"] }) status!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  acceptedAt!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Returned only when a token is newly created or explicitly rotated",
  })
  invitationToken!: string | null;
  @ApiProperty() tokenNotice!: string;
}

export class ProvisionTenantResponseDto {
  @ApiProperty() externalTenantId!: string;
  @ApiProperty({ type: CustomerAccountSummaryResponseDto })
  account!: CustomerAccountSummaryResponseDto;
  @ApiProperty({ type: WorkspaceResponseDto }) workspace!: WorkspaceResponseDto;
  @ApiProperty({ type: LegalEntityResponseDto }) legalEntity!: LegalEntityResponseDto;
  @ApiProperty({ type: ProvisionedOwnerInvitationResponseDto })
  ownerInvitation!: ProvisionedOwnerInvitationResponseDto;
  @ApiProperty({ type: WorkspaceOnboardingResponseDto })
  onboarding!: WorkspaceOnboardingResponseDto;
  @ApiProperty({
    description: "True when an earlier safe response was replayed for this tenant or key",
  })
  replayed!: boolean;
}

export class RoleResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: Number }) memberCount?: number;
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class WorkspaceMemberResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ["active", "suspended"] }) status!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) joinedAt!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class EmailDeliveryResponseDto {
  @ApiProperty({ enum: ["sent", "not_configured", "failed"] })
  status!: string;

  @ApiPropertyOptional({ enum: ["mailgun"], nullable: true })
  provider!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  messageId!: string | null;
}

export class CreatedInvitationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [String] }) roleCodes!: string[];
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ description: "Returned once; only its hash is persisted" }) invitationToken!: string;
  @ApiProperty() tokenNotice!: string;
  @ApiProperty({ type: EmailDeliveryResponseDto }) emailDelivery!: EmailDeliveryResponseDto;
}

export class ListedInvitationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ["pending", "accepted", "cancelled", "expired"] }) status!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) acceptedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty() invitedByName!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class CancelledInvitationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ example: "cancelled" }) status!: string;
  @ApiProperty({ format: "date-time" }) cancelledAt!: string;
}

export class ResentInvitationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ description: "Returned once; only its hash is persisted" }) invitationToken!: string;
  @ApiProperty() tokenNotice!: string;
  @ApiProperty({ type: EmailDeliveryResponseDto }) emailDelivery!: EmailDeliveryResponseDto;
}

export class IntegrationConnectionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) legalEntityId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) legalEntityName?: string | null;
  @ApiProperty({ enum: ["google_workspace", "quickbooks", "whatsapp", "payment", "custom"] })
  provider!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalAccountId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalDomain!: string | null;
  @ApiProperty({ enum: ["draft", "pending", "connected", "degraded", "revoked"] }) status!: string;
  @ApiPropertyOptional({ type: [String] }) grantedScopes?: string[];
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) lastSyncedAt?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lastErrorCode?: string | null;
  @ApiPropertyOptional({ type: "object", additionalProperties: true }) configuration?: Record<string, unknown>;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) revokedAt?: string | null;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiPropertyOptional({ format: "date-time" }) updatedAt?: string;
}

export class DeletedRoleResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: true }) deleted!: boolean;
}

export class AuditEventResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() source!: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty({ format: "uuid" }) entityId!: string;
  @ApiPropertyOptional({ type: "object", additionalProperties: true, nullable: true })
  before!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: "object", additionalProperties: true, nullable: true })
  after!: Record<string, unknown> | null;
  @ApiProperty({ format: "uuid" }) correlationId!: string;
  @ApiProperty({ format: "date-time" }) occurredAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actorName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) actorEmail!: string | null;
}

export class AuditPageResponseDto {
  @ApiProperty({ type: [AuditEventResponseDto] }) items!: AuditEventResponseDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) nextCursor!: string | null;
}
