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
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) accountId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) accountName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ["owner", "administrator", "member"] })
  accountRole!: string | null;
  @ApiProperty() isDefaultOrganization!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: () => WorkspaceOnboardingSummaryResponseDto })
  onboarding!: WorkspaceOnboardingSummaryResponseDto;
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
  @ApiProperty({ type: [PendingInvitationSummaryResponseDto] })
  pendingInvitations!: PendingInvitationSummaryResponseDto[];
  @ApiProperty({
    enum: ["accept_invitation", "start_onboarding", "resume_onboarding", "enter_workspace", "await_invitation"],
  })
  nextAction!: string;
}
