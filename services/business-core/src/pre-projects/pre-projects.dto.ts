import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { engagementPhases, engagementTransitionActions } from "./engagement-lifecycle";

export class ListPreProjectsDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["all", "qualified", "draft", "active", "on_hold", "released", "cancelled", "archived"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @IsIn(["true"]) pendingDeal?: "true";
}

export class PreProjectReadinessQueryDto {
  @IsOptional() @IsIn(["pricing"]) target?: "pricing";
}

export class StartPreProjectDto { @IsUUID() opportunityId!: string; }

export class StartFromQualifiedLeadDto {
  @IsUUID() leadId!: string;
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(60) nextActionAt?: string;
}

export class UpdateEngagementProfileDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) targetDate?: string | null;
  @IsOptional() @IsIn(["low", "normal", "high", "urgent"]) priority?: string;
  @IsOptional() @IsIn(["none", "low", "medium", "high", "critical"]) riskLevel?: string;
}

export class TransitionEngagementDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsIn(engagementTransitionActions) action!: typeof engagementTransitionActions[number];
  @IsOptional() @IsIn(engagementPhases) phase?: typeof engagementPhases[number];
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
