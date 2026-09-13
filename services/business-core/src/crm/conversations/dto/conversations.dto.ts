import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class ListConversationsQueryDto {
  @IsOptional() @IsIn(["open", "closed"]) status?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["true", "false"]) unread?: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(40) channel?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class UpdateConversationDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsIn(["open", "closed"]) status?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) subject?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string | null;
}

export class ListMessagesQueryDto {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 100;
}

export class CreateConversationDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsIn(["email", "whatsapp", "phone", "internal"]) channel!: string;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) participantPartyIds?: string[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) participantMembershipIds?: string[];
}

export class CreateMessageDto {
  @IsOptional() @IsUUID() clientMessageId?: string;
  @IsIn(["inbound", "outbound", "internal"]) direction!: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyText?: string;
  @IsOptional() @IsString() @MaxLength(200_000) bodyHtml?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsString() @MaxLength(80) purpose?: string;
  @IsOptional() @IsString() @MaxLength(500) providerMessageId?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class MessageReceiptDto {
  @IsUUID() workspaceId!: string;
  @IsIn(["sent", "delivered", "read", "failed"]) status!: string;
  @IsOptional() @IsString() @MaxLength(120) failureCode?: string;
  @IsOptional() @IsString() @MaxLength(500) providerMessageId?: string;
}

export class ProviderInboundMessageDto {
  @IsUUID() workspaceId!: string;
  @IsIn(["email", "whatsapp"]) channel!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) providerThreadId!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) providerMessageId!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) contact!: string;
  @IsOptional() @IsString() @MaxLength(240) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() @MaxLength(100_000) bodyText?: string;
  @IsOptional() @IsString() @MaxLength(200_000) bodyHtml?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class ProviderMessageReceiptDto {
  @IsUUID() workspaceId!: string;
  @IsIn(["sent", "delivered", "read", "failed"]) status!: string;
  @IsOptional() @IsString() @MaxLength(120) failureCode?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) providerMessageId!: string;
}

export class SequenceStepDto {
  @IsIn(["email", "whatsapp", "task", "delay"]) type!: string;
  @IsOptional() @IsInt() @Min(0) @Max(525_600) delayMinutes?: number;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

export class CreateSequenceDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsObject() exitConditions!: Record<string, unknown>;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SequenceStepDto) steps!: SequenceStepDto[];
}

export class UpdateSequenceDto extends CreateSequenceDto {
  @IsInt() @Min(1) version!: number;
}

export class SequenceVersionDto { @IsInt() @Min(1) version!: number; }

export class EnrollSequenceDto {
  @IsUUID() partyId!: string;
  @IsOptional() @IsUUID() leadId?: string;
}

export class StopSequenceEnrollmentDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class ProcessDueSequencesDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 50;
}
