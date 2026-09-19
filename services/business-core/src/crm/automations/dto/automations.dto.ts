import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";
export class CreateAutomationDto {
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,98}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(2_000) description?: string;
  @IsOptional() @IsBoolean() runOncePerAggregate?: boolean;
  @IsObject() definition!: Record<string, unknown>;
}
export class UpdateAutomationDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2_000) description?: string | null;
  @IsObject() definition!: Record<string, unknown>;
}
export class AutomationVersionDto { @IsInt() @Min(1) version!: number; }
export class DryRunAutomationDto { @IsObject() context!: Record<string, unknown>; }
export class UpdateAutomationPresetDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsArray() @IsIn(["in_app", "email"], { each: true }) channels?: string[];
  @IsOptional() @IsIn(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) weekday?: string;
}
export class ListAutomationRunsQueryDto { @IsOptional() @IsUUID() definitionId?: string; }
export class ApprovalDecisionDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["approved", "rejected"]) decision!: string;
  @IsOptional() @IsString() @MaxLength(1_000) reason?: string;
}
export class StartAutomationRunDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() triggerEventId!: string;
  @IsString() @MaxLength(80) aggregateType!: string;
  @IsUUID() aggregateId!: string;
  @IsUUID() correlationId!: string;
  @IsOptional() @IsUUID() causationId?: string;
  @IsOptional() @IsObject() context?: Record<string, unknown>;
}
export class AdvanceAutomationRunDto {
  @IsUUID() workspaceId!: string;
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{1,100}$/) stepKey!: string;
  @IsInt() @Min(1) attempt!: number;
  @IsIn(["running", "step_completed", "waiting", "approval_required", "completed", "failed", "cancelled"]) status!: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsObject() output?: Record<string, unknown>;
  @IsOptional() @IsObject() proposedAction?: Record<string, unknown>;
  @IsOptional() @IsUUID() requestedFromMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(120) failureCode?: string;
  @IsOptional() @IsString() @MaxLength(2_000) failureMessage?: string;
}
export class ClaimWorkspaceDto { @IsUUID() workspaceId!: string; @IsOptional() @IsInt() @Min(1) limit?: number; }
export class ExecuteAutomationStepDto {
  @IsUUID() workspaceId!: string;
  @IsString() @Matches(/^[a-zA-Z0-9_.-]{1,100}$/) stepKey!: string;
  @IsInt() @Min(1) attempt!: number;
}
export class CompleteAutomationWaitDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() claimToken!: string;
}
