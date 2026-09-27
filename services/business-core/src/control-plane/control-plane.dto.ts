import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
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
