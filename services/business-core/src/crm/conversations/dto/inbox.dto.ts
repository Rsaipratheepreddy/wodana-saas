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

export class WakeSnoozedDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 50;
}
