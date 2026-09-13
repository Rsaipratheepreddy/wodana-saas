import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class PipelineStageDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,62}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsInt() @Min(0) position!: number;
  @IsNumber() @Min(0) @Max(100) probability!: number;
  @IsOptional() @IsIn(["pipeline", "best_case", "commit", "closed"]) forecastCategory?: string;
  @IsOptional() @IsObject() entryRequirements?: Record<string, unknown>;
}

export class CreatePipelineDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,62}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PipelineStageDto)
  stages!: PipelineStageDto[];
}

export class UpdatePipelineDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class UpdatePipelineStageDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsIn(["pipeline", "best_case", "commit", "closed"]) forecastCategory?: string;
  @IsOptional() @IsObject() entryRequirements?: Record<string, unknown>;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class ListOpportunitiesQueryDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() pipelineId?: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsIn(["open", "won", "lost", "abandoned"]) status?: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class CreateOpportunityDto {
  @IsUUID() partyId!: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsUUID() pipelineId!: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsUUID() legalEntityId?: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
  @IsString() @IsNotEmpty() @MaxLength(240) title!: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsString() expectedCloseAt?: string;
  @IsOptional() @IsString() nextActionAt?: string;
}

export class QualifyLeadDto extends CreateOpportunityDto {
  @IsInt() @Min(1) leadVersion!: number;
}

export class UpdateOpportunityDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(240) title?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsUUID() ownerMembershipId?: string | null;
  @IsOptional() @IsNumber() @Min(0) amount?: number | null;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) probability?: number | null;
  @IsOptional() @IsString() expectedCloseAt?: string | null;
  @IsOptional() @IsString() nextActionAt?: string | null;
  @IsOptional() @IsString() @MaxLength(160) pausedReason?: string | null;
}

export class TransitionOpportunityDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() nextActionAt?: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @IsIn(["open", "won", "lost", "abandoned"]) status?: string;
  @IsOptional() @IsString() @MaxLength(160) reason?: string;
  @IsOptional() @IsString() @MaxLength(160) competitor?: string;
}

export class AddStakeholderDto {
  @IsUUID() partyId!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) role!: string;
  @IsOptional() @IsString() @MaxLength(30) influence?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class OpportunityTeamMemberDto {
  @IsString() @IsNotEmpty() @MaxLength(80) role!: string;
}

export class CreateProjectLinkDto {
  @IsUUID() projectId!: string;
  @IsOptional() @IsIn(["pre_sales", "delivery"]) mode?: string;
}
