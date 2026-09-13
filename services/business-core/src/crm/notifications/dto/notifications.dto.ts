import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";
export class CreateNotificationTemplateDto {
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,98}$/) code!: string;
  @IsIn(["in_app", "email", "whatsapp", "push", "webhook"]) channel!: string;
  @IsString() @MaxLength(35) locale!: string;
  @IsOptional() @IsString() @MaxLength(500) subjectTemplate?: string;
  @IsString() @IsNotEmpty() @MaxLength(100_000) bodyTemplate!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
  @IsOptional() @IsString() @MaxLength(255) providerTemplateId?: string;
}
export class ApproveTemplateDto { @IsInt() @Min(1) versionNumber!: number; }
export class CreateNotificationPolicyDto {
  @IsString() @MaxLength(120) eventType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsArray() @IsIn(["in_app", "email", "whatsapp", "push", "webhook"], { each: true }) channels!: string[];
  @IsOptional() @IsObject() conditions?: Record<string, unknown>;
  @IsOptional() @IsObject() quietHours?: Record<string, unknown>;
  @IsOptional() @IsObject() frequencyLimit?: Record<string, unknown>;
}
export class NotificationPolicyStatusDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["active", "paused", "archived"]) status!: string;
}
export class UpsertPreferenceDto {
  @IsIn(["user", "party", "integration"]) recipientType!: string;
  @IsUUID() recipientId!: string;
  @IsString() @MaxLength(120) eventType!: string;
  @IsIn(["in_app", "email", "whatsapp", "push", "webhook"]) channel!: string;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsObject() quietHours?: Record<string, unknown>;
}
export class EnqueueNotificationDto {
  @IsUUID() workspaceId!: string;
  @IsIn(["user", "party", "integration"]) recipientType!: string;
  @IsUUID() recipientId!: string;
  @IsIn(["in_app", "email", "whatsapp", "push", "webhook"]) channel!: string;
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,98}$/) templateCode!: string;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
  @IsString() @MaxLength(120) eventType!: string;
  @IsObject() variables!: Record<string, unknown>;
  @IsString() @MaxLength(160) idempotencyKey!: string;
  @IsUUID() correlationId!: string;
  @IsOptional() @IsString() @MaxLength(2_000) deepLink?: string;
  @IsOptional() @IsString() scheduledFor?: string;
}
export class ClaimNotificationJobsDto { @IsUUID() workspaceId!: string; @IsOptional() @IsInt() @Min(1) limit?: number; }
export class NotificationResultDto {
  @IsUUID() workspaceId!: string;
  @IsInt() @Min(1) attempt!: number;
  @IsString() @MaxLength(60) provider!: string;
  @IsIn(["delivered", "retry", "permanent_failure"]) result!: string;
  @IsOptional() @IsString() @MaxLength(500) providerMessageId?: string;
  @IsOptional() @IsString() @MaxLength(120) errorCode?: string;
  @IsOptional() @IsString() @MaxLength(2_000) errorMessage?: string;
}
