import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class UpdateTenantEntitlementsDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(40) planCode!: string;
  @IsInt() @Min(1) planVersion!: number;
  @IsIn(["scheduled", "active", "suspended"]) status!: "scheduled" | "active" | "suspended";
  @IsArray() @ArrayUnique() @ArrayMaxSize(5)
  @IsIn(["workspace", "crm", "pre-project", "projects", "hrms"], { each: true })
  modules!: string[];
  @IsObject() limits!: Record<string, unknown>;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveUntil?: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class UpdatePlatformCapabilityDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120)
  code!: string;
  @IsIn(["workspace", "crm", "pre-project", "projects", "hrms"])
  module!: "workspace" | "crm" | "pre-project" | "projects" | "hrms";
  @IsIn(["unavailable", "internal_preview", "available"])
  releaseState!: "unavailable" | "internal_preview" | "available";
  @IsInt() @Min(0) expectedVersion!: number;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class UpdateTenantDataPolicyDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @Type(() => Number) @IsInt() @Min(1024 * 1024) @Max(10 * 1024 * 1024 * 1024 * 1024)
  storageQuotaBytes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) retentionDays!: number;
  @IsBoolean() legalHold!: boolean;
  @IsIn(["required", "optional"]) scanRequirement!: "required" | "optional";
  @IsBoolean() exportBeforeErasure!: boolean;
}

export class RequestTenantSupportSessionDto {
  @IsIn(["read_only", "limited_write"]) accessLevel!: "read_only" | "limited_write";
  @Type(() => Number) @IsInt() @Min(15) @Max(480) durationMinutes!: number;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class DecideTenantSupportSessionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(["approve", "reject", "revoke"]) decision!: "approve" | "reject" | "revoke";
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class TransitionTenantLifecycleDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(["draft", "trial", "active", "grace", "suspended", "archived"])
  to!: "draft" | "trial" | "active" | "grace" | "suspended" | "archived";
  @IsOptional() @IsDateString() graceEndsAt?: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class CreateTenantOperationPlanDto {
  @IsIn(["clone", "export", "erasure"]) operationType!: "clone" | "export" | "erasure";
  @ValidateIf((input: CreateTenantOperationPlanDto) => input.operationType === "clone" && !input.rollbackOf)
  @IsString() @MinLength(1) @MaxLength(160)
  targetExternalTenantId?: string;
  @IsOptional() @IsUUID() rollbackOf?: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class DecideTenantOperationDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(["approve", "cancel"]) decision!: "approve" | "cancel";
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class UpdateAccountContractDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(["trial_uncontracted", "contracted", "expired"])
  status!: "trial_uncontracted" | "contracted" | "expired";
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(40) planCode!: string;
  @IsInt() @Min(1) planVersion!: number;
  @Transform(trim) @IsString() @Matches(/^[A-Za-z]{3}$/) currency!: string;
  @IsIn(["monthly", "yearly", "custom"]) billingCycle!: "monthly" | "yearly" | "custom";
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) recurringAmount!: number;
  @Type(() => Number) @IsInt() @Min(1) seatLimit!: number;
  @Type(() => Number) @IsInt() @Min(1) projectLimit!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) contractReference?: string | null;
  @IsOptional() @IsDateString() signedAt?: string | null;
  @IsOptional() @IsDateString() trialEndsAt?: string | null;
  @IsDateString() termStartsAt!: string;
  @IsOptional() @IsDateString() renewsAt?: string | null;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveUntil?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) legalEntityReference?: string | null;
  @IsOptional() @IsObject() terms?: Record<string, unknown>;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class UpdateOrganizationBillingAllocationDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(["scheduled", "active", "suspended", "ended"])
  status!: "scheduled" | "active" | "suspended" | "ended";
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) allocatedAmount!: number;
  @Type(() => Number) @IsInt() @Min(1) seatLimit!: number;
  @Type(() => Number) @IsInt() @Min(1) projectLimit!: number;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveUntil?: string | null;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class RecordAccountBillingDocumentEventDto {
  @IsIn(["invoice", "credit_note", "receipt"])
  documentType!: "invoice" | "credit_note" | "receipt";
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(50) provider!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) externalReference!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) documentNumber?: string | null;
  @IsIn(["created", "provider_notification", "finance_verified", "corrected"])
  eventType!: "created" | "provider_notification" | "finance_verified" | "corrected";
  @IsIn(["draft", "issued", "past_due", "paid", "applied", "verified", "failed", "void", "refunded"])
  status!: "draft" | "issued" | "past_due" | "paid" | "applied" | "verified" | "failed" | "void" | "refunded";
  @Transform(trim) @IsString() @Matches(/^[A-Za-z]{3}$/) currency!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalAmount!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) balanceAmount!: number;
  @IsOptional() @IsDateString() issuedAt?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsDateString() settledAt?: string | null;
  @IsDateString() occurredAt!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) legalEntityReference?: string | null;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateAccountCollectionStateDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(["current", "grace", "past_due", "collections", "suspended", "closed"])
  status!: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed";
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) overdueAmount!: number;
  @Transform(trim) @IsString() @Matches(/^[A-Za-z]{3}$/) currency!: string;
  @IsOptional() @IsDateString() effectiveAt?: string;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class CaptureAccountUsageSnapshotDto {
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsIn(["computed", "provider_import"]) source!: "computed" | "provider_import";
}
