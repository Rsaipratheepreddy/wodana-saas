import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional, ValidateIf,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";

export class IntakePartyDto {
  @IsString() @IsNotEmpty() @MaxLength(240) displayName!: string;
  @IsOptional() @IsString() @MaxLength(500) email?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) mobile!: string;
  @IsOptional() @IsString() @MaxLength(240) company?: string;
  @IsOptional() @IsString() @MaxLength(160) jobPosition?: string;
  @IsOptional() @IsString() @MaxLength(2000) website?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @IsOptional() @IsString() @MaxLength(2) phoneCountryCode?: string;
  @IsOptional() @IsString() @MaxLength(2) mobileCountryCode?: string;
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

/** §0.3 P0: the floor plan: uploaded (one of the enquiry's files), not available yet with a size estimate, or not needed. */
export class FloorPlanDto {
  @IsIn(["uploaded", "not_available", "not_required"]) status!: "uploaded" | "not_available" | "not_required";
  @IsOptional() @IsUUID() assetId?: string;
  /** The built-up area or an estimate the client gives ("2–3 bedroom villa"). */
  @IsOptional() @IsString() @MaxLength(120) builtUpArea?: string;
  /** Guide D: the plot size, optional (villas). */
  @IsOptional() @IsString() @MaxLength(120) plotSize?: string;
}

export class EnquiryDetailsDto {
  @IsString() @IsNotEmpty() @MaxLength(80) emirate!: string;
  @IsOptional() @IsString() @MaxLength(240) area?: string;
  @IsOptional() @IsString() @MaxLength(240) location?: string;
  @IsOptional() @IsString() @MaxLength(80) customerType?: string;
  @IsOptional() @IsString() @MaxLength(80) budgetRange?: string;
  @IsOptional() @IsString() @MaxLength(80) projectType?: string;
  @IsOptional() @ValidateNested() @Type(() => FloorPlanDto) floorPlan?: FloorPlanDto;
  /** PLM-155: the date the client wants the work finished (YYYY-MM-DD); Sales collect it but don't promise it. */
  @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: "Enter the target completion as a date" }) targetCompletion?: string;
  @IsOptional() @IsString() @MaxLength(160) campaign?: string;
  @IsOptional() @IsString() @MaxLength(10000) internalNotes?: string;
}

export class ReferralDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(160) contact?: string;
  @IsOptional() @IsUUID() membershipId?: string;
  @IsOptional() @IsString() @MaxLength(100) option?: string;
}

export class InitialAssignmentDto {
  @IsIn(["automatic", "manual", "unassigned"]) mode!: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsUUID() queueId?: string;
}

/** PLM-100: one team role on the enquiry: a member, or not applicable for this enquiry type (neither clears it). */
export class LeadTeamDto {
  @IsString() @IsNotEmpty() @MaxLength(40) role!: string;
  @IsOptional() @IsUUID() membershipId?: string | null;
  @IsOptional() @IsBoolean() notApplicable?: boolean;
}

export class UpdateLeadDetailsDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LeadTeamDto) team?: LeadTeamDto[];
  @IsOptional() @IsString() @MaxLength(240) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) summary?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) serviceType!: string;
  @IsDefined() @ValidateNested() @Type(() => IntakePartyDto) party!: IntakePartyDto;
  @IsDefined() @ValidateNested() @Type(() => EnquiryDetailsDto) details!: EnquiryDetailsDto;
  /** Correct where the enquiry came from; source and channel change together. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) source?: string;
  @ValidateIf((dto: UpdateLeadDetailsDto) => dto.source !== undefined) @IsString() @IsNotEmpty() @MaxLength(60) channel?: string;
  @IsOptional() @ValidateNested() @Type(() => ReferralDto) referral?: ReferralDto;
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
  @IsDefined() @ValidateNested() @Type(() => EnquiryDetailsDto) details!: EnquiryDetailsDto;
  @IsOptional() @ValidateNested() @Type(() => InitialAssignmentDto) assignment?: InitialAssignmentDto;
  @IsOptional() @ValidateNested() @Type(() => ReferralDto) referral?: ReferralDto;
  @IsOptional() @IsString() @MaxLength(10_000) summary?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) serviceType!: string;
  @IsObject() originalPayload!: Record<string, unknown>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributionTouchDto)
  attribution?: AttributionTouchDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IntakeConsentDto)
  consents?: IntakeConsentDto[];
  /**
   * LF-1: the person entering the enquiry already said who the client is: this existing client
   * (`existing` with `partyId`) or a different person (`new`). Staff entry only; ignored elsewhere.
   */
  @IsOptional() @IsIn(["existing", "new"]) identity?: "existing" | "new";
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LeadTeamDto) team?: LeadTeamDto[];
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
