import { Type } from "class-transformer";
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class IntakePartyDto {
  @IsString() @IsNotEmpty() @MaxLength(240) displayName!: string;
  @IsOptional() @IsString() @MaxLength(500) email?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) mobile?: string;
  @IsOptional() @IsString() @MaxLength(240) company?: string;
  @IsOptional() @IsString() @MaxLength(160) jobPosition?: string;
  @IsOptional() @IsString() @MaxLength(2000) website?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @IsOptional() @IsString() @MaxLength(2) phoneCountryCode?: string;
  @IsOptional() @IsString() @MaxLength(35) preferredLocale?: string;
  @IsOptional() @IsString() @MaxLength(64) preferredTimezone?: string;
}

export class AttributionTouchDto {
  @IsString() @IsNotEmpty() @MaxLength(100) source!: string;
  @IsOptional() @IsString() @MaxLength(100) medium?: string;
  @IsOptional() @IsString() @MaxLength(160) campaign?: string;
  @IsOptional() @IsString() @MaxLength(160) content?: string;
  @IsOptional() @IsString() @MaxLength(160) term?: string;
  @IsOptional() @IsString() @MaxLength(2000) referrer?: string;
  @IsOptional() @IsString() @MaxLength(255) externalClickId?: string;
  @IsOptional() @IsString() touchedAt?: string;
}

export class IntakeConsentDto {
  @IsString() @IsNotEmpty() @MaxLength(80) purpose!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) channel!: string;
  @IsIn(["unknown", "granted", "denied", "withdrawn"]) status!: string;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(20) jurisdiction?: string;
}

export class EnquiryDetailsDto {
  @IsOptional() @IsString() @MaxLength(240) location?: string;
  @IsOptional() @IsString() @MaxLength(80) customerType?: string;
  @IsOptional() @IsString() @MaxLength(80) budgetRange?: string;
  @IsOptional() @IsString() @MaxLength(160) campaign?: string;
  @IsOptional() @IsString() @MaxLength(10000) internalNotes?: string;
}

export class InitialAssignmentDto {
  @IsIn(["automatic", "manual", "unassigned"]) mode!: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsUUID() queueId?: string;
}

export class UpdateLeadDetailsDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(240) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) summary?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) serviceType!: string;
  @IsDefined() @ValidateNested() @Type(() => IntakePartyDto) party!: IntakePartyDto;
  @IsDefined() @ValidateNested() @Type(() => EnquiryDetailsDto) details!: EnquiryDetailsDto;
}

export class CreateIntakeEventDto {
  @IsOptional() @IsUUID() workspaceId?: string;
  @IsOptional() @IsUUID() legalEntityId?: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) source!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) channel!: string;
  @IsIn(["form", "manual", "import", "automated", "api", "webhook"])
  intakeMethod!: string;
  @IsOptional() @IsString() @MaxLength(255) externalEventId?: string;
  @IsOptional() @IsString() @MaxLength(500) payloadReference?: string;
  @IsOptional() @IsString() receivedAt?: string;
  @IsDefined() @ValidateNested() @Type(() => IntakePartyDto) party!: IntakePartyDto;
  @IsOptional() @IsString() @MaxLength(240) title?: string;
  @IsOptional() @ValidateNested() @Type(() => EnquiryDetailsDto) details?: EnquiryDetailsDto;
  @IsOptional() @ValidateNested() @Type(() => InitialAssignmentDto) assignment?: InitialAssignmentDto;
  @IsOptional() @IsString() @MaxLength(10_000) summary?: string;
  @IsOptional() @IsString() @MaxLength(100) serviceType?: string;
  @IsObject() originalPayload!: Record<string, unknown>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributionTouchDto)
  attribution?: AttributionTouchDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IntakeConsentDto)
  consents?: IntakeConsentDto[];
}

export class ListIntakeQueryDto {
  @IsOptional() @IsIn(["received", "processing", "ready", "needs_review", "failed", "duplicate_candidate", "superseded"])
  status?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class ListEnquiriesQueryDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsIn(["open", "qualified", "disqualified", "closed"]) status?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(60) channel?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class ReviewDuplicateDto {
  @IsIn(["attach", "create_new", "reject"]) decision!: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsInt() @Min(1) version!: number;
}

export class FailIntakeDto {
  @IsString() @IsNotEmpty() @MaxLength(120) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;
  @IsInt() @Min(1) version!: number;
}
