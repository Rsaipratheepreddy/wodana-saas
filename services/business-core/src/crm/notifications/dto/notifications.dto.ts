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
export class RecordDeviceConsentDto {
  @IsUUID() requestId!: string;
  @IsUUID() installationId!: string;
  @IsIn(["ios", "android"]) platform!: "ios" | "android";
  @IsIn(["undetermined", "denied", "granted", "provisional", "ephemeral"])
  status!: "undetermined" | "denied" | "granted" | "provisional" | "ephemeral";
  @IsString() @Matches(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/) @MaxLength(35) locale!: string;
  @IsString() @MaxLength(64) timezone!: string;
}
export class RegisterDeviceEndpointDto extends RecordDeviceConsentDto {
  @IsIn(["expo"]) tokenType!: "expo";
  @IsString() @Matches(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,}\]$/) @MaxLength(500) token!: string;
}
export class PushPreferenceDto { @IsBoolean() enabled!: boolean; }
export class RevokeDeviceEndpointDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
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
  @IsIn(["accepted", "delivered", "retry", "permanent_failure"]) result!: string;
  @IsOptional() @IsString() @MaxLength(500) providerMessageId?: string;
  @IsOptional() @IsString() @MaxLength(120) errorCode?: string;
  @IsOptional() @IsString() @MaxLength(2_000) errorMessage?: string;
  @IsOptional() @IsString() @Matches(/^redis:push:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/i) @MaxLength(500) endpointReference?: string;
}
export class ClaimPushReceiptsDto { @IsUUID() workspaceId!: string; @IsOptional() @IsInt() @Min(1) limit?: number; }
export class PushReceiptResultDto {
  @IsUUID() workspaceId!: string;
  @IsInt() @Min(1) attempt!: number;
  @IsString() @MaxLength(500) providerMessageId!: string;
  @IsIn(["delivered", "retry", "permanent_failure"]) result!: string;
  @IsOptional() @IsString() @MaxLength(120) errorCode?: string;
  @IsOptional() @IsString() @MaxLength(2_000) errorMessage?: string;
}
