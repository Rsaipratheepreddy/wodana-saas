import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
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

export class ListLeadsQueryDto {
  @IsOptional() @IsIn(["new", "attempting_contact", "connected", "nurturing", "qualified", "disqualified", "paused", "duplicate"])
  status?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsUUID() queueId?: string;
  /** A salesperson's lists (PLM-042): new, contacted (being worked) or come back to (booked follow-up). */
  @IsOptional() @IsIn(["new", "contacted", "come_back"]) funnel?: "new" | "contacted" | "come_back";
  /** Only enquiries owned by the signed-in member. */
  @IsOptional() @IsIn(["true", "false"]) mine?: string;
  @IsOptional() @IsString() @MaxLength(240) search?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class CreateQueueDto {
  @IsString() @IsNotEmpty() @MaxLength(64) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
  @IsOptional() @IsBoolean() isFallback?: boolean;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(10080) takeoverAfterMinutes?: number;
  /** Working hours for the takeover countdown (same shape as an SLA schedule); omit for elapsed time. */
  @IsOptional() @IsObject() takeoverSchedule?: Record<string, unknown>;
}

export class UpdateQueueDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsUUID() businessUnitId?: string | null;
  @IsOptional() @IsBoolean() isFallback?: boolean;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(10080) takeoverAfterMinutes?: number | null;
  @IsOptional() @IsObject() takeoverSchedule?: Record<string, unknown> | null;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class AddQueueMemberDto {
  @IsUUID() membershipId!: string;
  @IsInt() @Min(1) @Max(10_000) capacity!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) weight?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) languages?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) territories?: string[];
  @IsOptional() @IsString() unavailableUntil?: string;
}

export class AssignmentRuleInputDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(100_000) priority!: number;
  @IsUUID() queueId!: string;
  @IsObject() conditions!: Record<string, unknown>;
}

export class CreateAssignmentPolicyDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(100_000) priority!: number;
  @IsUUID() fallbackQueueId!: string;
  @IsOptional() @IsBoolean() preserveRelationshipOwner?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AssignmentRuleInputDto) rules?: AssignmentRuleInputDto[];
}

export class UpdateAssignmentPolicyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) priority?: number;
  @IsOptional() @IsUUID() fallbackQueueId?: string;
  @IsOptional() @IsBoolean() preserveRelationshipOwner?: boolean;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AssignmentRuleInputDto) rules?: AssignmentRuleInputDto[];
}

export class CreateSlaPolicyDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) eventType!: string;
  @IsInt() @Min(0) @Max(525_600) warningAfterMinutes!: number;
  @IsInt() @Min(1) @Max(525_600) breachAfterMinutes!: number;
  @IsOptional() @IsIn(["elapsed", "business"]) calculationMode?: string;
  @IsOptional() @IsObject() schedule?: Record<string, unknown>;
}

export class UpdateSlaPolicyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) eventType?: string;
  @IsOptional() @IsInt() @Min(0) @Max(525_600) warningAfterMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(525_600) breachAfterMinutes?: number;
  @IsOptional() @IsIn(["elapsed", "business"]) calculationMode?: string;
  @IsOptional() @IsObject() schedule?: Record<string, unknown>;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class AssignLeadDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsUUID() queueId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class TransitionLeadDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["new", "attempting_contact", "connected", "nurturing", "qualified", "disqualified", "paused"])
  status!: string;
  @IsOptional() @IsString() @MaxLength(160) reason?: string;
  @IsOptional() @IsString() nextActionAt?: string;
}

export class UpsertQualificationDto {
  @IsInt() @Min(1) version!: number;
  @IsObject() values!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) @Max(100) fitScore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) engagementScore?: number;
}

export class ProcessSlaDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}

/** LF-1: who already has this mobile or email. */
export class ContactMatchQueryDto {
  @IsOptional() @IsString() @MaxLength(40) mobile?: string;
  @IsOptional() @IsString() @MaxLength(3) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

/** S-3: confirm a form enquiry's client: the suggested existing client, or a different person. */
export class ConfirmClientDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["same", "different"]) decision!: "same" | "different";
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsString() @MaxLength(240) reason?: string;
}

/** S-10: "Not a duplicate — open as new", with the reason. */
export class ReopenDuplicateDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @IsNotEmpty() @MaxLength(240) reason!: string;
}

export class UpdateSalesSettingsDto {
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) takeoverCap?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) unownedEscalationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) clientReviewMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(730) duplicateWindowDays?: number;
  @IsOptional() @IsUUID() salesAdminMembershipId?: string | null;
}

export class LogContactDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["call", "whatsapp", "email", "meeting", "sms"]) channel!: "call" | "whatsapp" | "email" | "meeting" | "sms";
  @IsIn(["no_answer", "message_sent_no_reply", "willing_to_talk", "come_back_later", "not_interested"])
  outcome!: "no_answer" | "message_sent_no_reply" | "willing_to_talk" | "come_back_later" | "not_interested";
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
  @IsOptional() @IsString() @MaxLength(160) reason?: string;
  @IsOptional() @IsString() nextActionAt?: string;
}
