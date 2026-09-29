import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { LABEL_COLORS, TEMPLATE_VARIABLE_SOURCES } from "../inbox/inbox-rules";

export class BulkConversationsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) conversationIds!: string[];
  @IsIn(["assign", "resolve", "reopen", "snooze", "label", "unlabel"]) action!: string;
  /** For assign: the new owner, or null to unassign. */
  @IsOptional() @IsUUID() ownerMembershipId?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) snoozedUntil?: string;
  @IsOptional() @IsUUID() labelId?: string;
}

export class BlockConversationDto {
  @IsBoolean() blocked!: boolean;
  /** With blocked: also mark the number as spam. */
  @IsOptional() @IsBoolean() spam?: boolean;
}

export class HideMessageDto {
  @IsBoolean() hidden!: boolean;
}

export class SetConversationLabelsDto {
  @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) labelIds!: string[];
}

export class CreateLabelDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsIn(LABEL_COLORS) color!: string;
}

export class UpdateLabelDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(LABEL_COLORS) color?: string;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class CreateQuickReplyDto {
  /** Typed after "/" in the composer; no spaces. */
  @IsString() @Matches(/^\S{1,40}$/u) shortcut!: string;
  @IsString() @IsNotEmpty() @MaxLength(4096) body!: string;
  @IsIn(["workspace", "personal"]) scope!: string;
}

export class UpdateQuickReplyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @Matches(/^\S{1,40}$/u) shortcut?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) body?: string;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class UpdateInboxSettingsDto {
  /** 0 when the workspace has never saved its inbox settings. */
  @IsInt() @Min(0) version!: number;
  @IsBoolean() autoAssign!: boolean;
  @IsOptional() @IsUUID() queueId?: string | null;
  @IsBoolean() signatureEnabled!: boolean;
  /** Days a chat stays quiet after our last message before it resolves itself; 0 for never (AU-2). */
  @IsOptional() @IsInt() @Min(0) @Max(60) autoResolveDays?: number;
}

export class TemplateVariableDto {
  @IsInt() @Min(1) @Max(20) position!: number;
  @IsIn(TEMPLATE_VARIABLE_SOURCES) source!: string;
}

export class SetTemplateVariablesDto {
  /** The mapping's current version (0 when none is saved). */
  @IsInt() @Min(0) version!: number;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TemplateVariableDto) variables!: TemplateVariableDto[];
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Settings → Inbox → Auto replies, for the workspace (no connectionId) or one WhatsApp number. */
export class UpdateAutoRepliesDto {
  /** A connected WhatsApp number whose own settings these are; omitted for the workspace's. */
  @IsOptional() @IsUUID() connectionId?: string | null;
  /** 0 when this scope has never been saved. */
  @IsInt() @Min(0) version!: number;
  @IsBoolean() greetingEnabled!: boolean;
  @IsString() @MaxLength(1024) greetingText!: string;
  @IsInt() @Min(1) @Max(365) greetingSilenceDays!: number;
  @IsBoolean() awayEnabled!: boolean;
  @IsString() @MaxLength(1024) awayText!: string;
  @IsInt() @Min(1) @Max(168) awayWindowHours!: number;
  /** 0 = Sunday … 6 = Saturday; null follows the workspace's working week. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workingDays?: number[] | null;
  /** "HH:MM"; both or neither (neither follows the work calendar). */
  @IsOptional() @IsString() @Matches(CLOCK) dayStart?: string | null;
  @IsOptional() @IsString() @Matches(CLOCK) dayEnd?: string | null;
  /** An IANA time zone; null follows the workspace's. */
  @IsOptional() @IsString() @MaxLength(64) timeZone?: string | null;
}

export class RemoveAutoRepliesDto {
  @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class WakeSnoozedDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 50;
}
