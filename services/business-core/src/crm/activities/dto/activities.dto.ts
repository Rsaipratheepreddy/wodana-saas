import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
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

export class CreateAppointmentDto {
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) timezone!: string;
  @IsOptional() @IsObject() location?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) attendeePartyIds?: string[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) attendeeMembershipIds?: string[];
}

export class UpdateAppointmentDto extends CreateAppointmentDto {
  @IsInt() @Min(1) version!: number;
}

export class ListActivitiesQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() opportunityId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsIn(["pending", "completed", "cancelled"]) status?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class CreateActivityDto {
  @IsOptional() @ValidateNested() @Type(() => CreateAppointmentDto) appointment?: CreateAppointmentDto;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() opportunityId?: string;
  @IsIn(["task", "note", "call", "meeting", "email", "whatsapp", "sms", "portal", "other"])
  type!: string;
  @IsOptional() @IsIn(["inbound", "outbound", "internal"]) interactionDirection?: string;
  @IsString() @IsNotEmpty() @MaxLength(240) title!: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsIn(["low", "normal", "high", "urgent"]) priority?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsBoolean() isNextAction?: boolean;
  @IsOptional() @IsBoolean() customerVisible?: boolean;
}

export class UpdateActivityDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(240) title?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsIn(["inbound", "outbound", "internal"]) interactionDirection?: string | null;
  @IsOptional() @IsUUID() ownerMembershipId?: string | null;
  @IsOptional() @IsIn(["low", "normal", "high", "urgent"]) priority?: string;
  @IsOptional() @IsString() dueAt?: string | null;
  @IsOptional() @IsBoolean() isNextAction?: boolean;
}

export class CompleteActivityDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(120) outcome?: string;
}
