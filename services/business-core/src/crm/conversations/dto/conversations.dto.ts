import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class ListConversationsQueryDto {
  /** Open, Snoozed or Resolved ('closed'). */
  @IsOptional() @IsIn(["open", "snoozed", "closed"]) status?: string;
  /** Mine, Unassigned, Team (people who share a queue with me) or All. */
  @IsOptional() @IsIn(["mine", "unassigned", "team", "all"]) view?: string;
  @IsOptional() @IsUUID() labelId?: string;
  /** Longest-waiting first (the default for Open) or most recent first. */
  @IsOptional() @IsIn(["waiting", "recent"]) sort?: string;
  /** Linked-record stages, comma-separated (lead:<status>, opportunity:<stageId>, project:<stageKey>, none). */
  @IsOptional() @IsString() @MaxLength(1000) stage?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["true", "false"]) unread?: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(40) channel?: string;
  /** Chats with one WhatsApp number (the number the client last wrote to). */
  @IsOptional() @IsUUID() connectionId?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class UpdateConversationDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsIn(["open", "snoozed", "closed"]) status?: string;
  /** Required with status snoozed: when the chat comes back. */
  @IsOptional() @IsISO8601({ strict: true }) snoozedUntil?: string;
  /** Link the chat to the client's enquiry (null unlinks). */
  @IsOptional() @IsUUID() leadId?: string | null;
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
  /** Values for the template's {{1}}…{{n}}; when omitted they are filled from the chat's records. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) templateParameters?: string[];
  @IsOptional() @IsString() @MaxLength(80) purpose?: string;
  @IsOptional() @IsString() @MaxLength(500) providerMessageId?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  /** People (memberships) @mentioned in an internal note; each is told. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) mentions?: string[];
  /** A file uploaded to this chat first (one per message, as WhatsApp sends it); the text is its caption. */
  @IsOptional() @IsUUID() attachmentId?: string;
}

/** "Send later": a template at any time, or free text while WhatsApp's 24-hour window will still be open then. */
export class CreateScheduledMessageDto {
  @IsUUID() clientRequestId!: string;
  @IsISO8601({ strict: true }) sendAt!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) bodyText?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) templateParameters?: string[];
}

/** Changes a scheduled message before it goes: its time, its text, or its template's values. */
export class UpdateScheduledMessageDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsISO8601({ strict: true }) sendAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) bodyText?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) templateParameters?: string[];
}

export class ScheduledMessageVersionDto { @IsInt() @Min(1) version!: number; }

export class ProcessDueScheduledMessagesDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 50;
}

/** The worker's claim of client files to fetch from the provider. */
export class ClaimAttachmentFetchesDto {
  @IsOptional() @IsInt() @Min(1) @Max(50) limit = 20;
}

/** A fetch that did not work: retried later when the provider may recover, else the file is marked unavailable. */
export class AttachmentFetchFailedDto {
  @IsString() @IsNotEmpty() @MaxLength(120) code!: string;
  @IsBoolean() retryable!: boolean;
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
