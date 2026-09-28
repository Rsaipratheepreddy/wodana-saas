import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { TENANT_LIFECYCLE_STATES } from "../workspaces/tenant-lifecycle.domain";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ListAccountsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @ApiPropertyOptional({ enum: TENANT_LIFECYCLE_STATES }) @IsOptional() @IsIn([...TENANT_LIFECYCLE_STATES]) state?: string;
}

export class SlugAvailabilityQueryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(70) @Matches(/^[a-z0-9-]+$/) slug!: string;
}

export class RequestSupportSessionDto {
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(480) durationMinutes!: number;
}

export class SupportSessionCommandDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class ChangeSeatLimitDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) seatLimit!: number;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class VersionedDomainCommandDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class RecordCertificateDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsDateString() expiresAt!: string;
}

/** Credits and prices travel as decimal strings (never floats): up to ten digits and four decimals. */
const asDecimalText = ({ value }: { value: unknown }) => typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : value;
const CREDITS = /^\d{1,10}(\.\d{1,4})?$/;
const SIGNED_CREDITS = /^-?\d{1,10}(\.\d{1,4})?$/;

export class AiCreditTopUpDto {
  @Transform(asDecimalText) @IsString() @Matches(CREDITS) credits!: string;
  /** The invoice or payment note the credits were paid with. */
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) reference!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class AiCreditAdjustmentDto {
  @IsIn(["adjustment", "refund"]) kind!: "adjustment" | "refund";
  @Transform(asDecimalText) @IsString() @Matches(SIGNED_CREDITS) credits!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) reference!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class AiCreditThresholdDto {
  @IsInt() @Min(1) expectedVersion!: number;
  /** Credits, or null for 20% of the balance after the last top-up. */
  @ValidateIf((_, value) => value !== null) @Transform(asDecimalText) @IsString() @Matches(CREDITS) threshold!: string | null;
}

export class AiModelRateDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(asDecimalText) @IsString() @Matches(CREDITS) listInput!: string;
  @Transform(asDecimalText) @IsString() @Matches(CREDITS) listOutput!: string;
  @Transform(asDecimalText) @IsString() @Matches(/^\d{1,3}(\.\d{1,3})?$/) margin!: string;
  @IsBoolean() priceConfirmed!: boolean;
  @IsBoolean() active!: boolean;
}
