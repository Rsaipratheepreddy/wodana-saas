import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class IdentityResponseDto {
  @ApiProperty() provider!: string;
  @ApiProperty() subject!: string;
}

export class WorkspaceOnboardingSummaryResponseDto {
  @ApiProperty({ enum: ["not_started", "in_progress", "completed"] }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) currentStep!: string | null;
  @ApiProperty({ type: [String] }) completedSteps!: string[];
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class MembershipSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() workspaceName!: string;
  @ApiProperty() workspaceSlug!: string;
  @ApiProperty() workspaceStatus!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) workspaceLogoUrl!: string | null;
  @ApiPropertyOptional({ example: "#0B7F5D", type: String, nullable: true })
  workspacePrimaryColor!: string | null;
  @ApiPropertyOptional({ example: "#000000", type: String, nullable: true })
  workspaceSecondaryColor!: string | null;
  @ApiPropertyOptional({ example: "alta", type: String, nullable: true })
  workspaceHeadingFont!: string | null;
  @ApiPropertyOptional({ example: "montserrat", type: String, nullable: true })
  workspaceBodyFont!: string | null;
  @ApiPropertyOptional({ example: "en-AE", type: String, nullable: true }) workspaceLocale!: string | null;
  @ApiPropertyOptional({ example: "AED", type: String, nullable: true }) workspaceCurrency!: string | null;
  @ApiPropertyOptional({ example: "Asia/Dubai", type: String, nullable: true }) workspaceTimezone!: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) accountId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) accountName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ["owner", "administrator", "member"] })
  accountRole!: string | null;
  @ApiProperty() isDefaultOrganization!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String], description: "The signed-in member's effective permission codes after organization entitlements are applied" })
  allowedPermissions!: string[];
  @ApiProperty({ type: [String], description: "Modules allowed by both the organization's commercial entitlements and the member's effective role grants" })
  allowedModules!: string[];
  @ApiProperty({ description: "Commercial entitlement state. Legacy organizations remain explicitly not configured until an operator assigns a versioned set." })
  entitlement!: { status: string; version: number | null };
  @ApiProperty({ type: () => WorkspaceOnboardingSummaryResponseDto })
  onboarding!: WorkspaceOnboardingSummaryResponseDto;
}

export class UnavailableOrganizationResponseDto {
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() workspaceName!: string;
  @ApiProperty() workspaceSlug!: string;
  @ApiProperty({ enum: ["suspended", "archived"] }) workspaceStatus!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) accountName!: string | null;
}

export class PendingInvitationSummaryResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() workspaceName!: string;
  @ApiProperty() workspaceSlug!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}

export class MeResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) primaryEmail!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ example: "en" }) preferredLocale!: string;
  @ApiProperty({ example: "UTC" }) preferredTimezone!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ["administrator"] })
  platformRole!: string | null;
  @ApiProperty({ type: IdentityResponseDto }) identity!: IdentityResponseDto;
  @ApiPropertyOptional({ type: [MembershipSummaryResponseDto] })
  memberships!: MembershipSummaryResponseDto[];
  @ApiProperty({ type: [UnavailableOrganizationResponseDto] })
  unavailableOrganizations!: UnavailableOrganizationResponseDto[];
  @ApiProperty({ type: [PendingInvitationSummaryResponseDto] })
  pendingInvitations!: PendingInvitationSummaryResponseDto[];
  @ApiProperty({
    enum: ["accept_invitation", "start_onboarding", "resume_onboarding", "enter_workspace", "await_invitation"],
  })
  nextAction!: string;
}
