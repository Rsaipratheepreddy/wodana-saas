import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class DiscoveredIntegrationResourceDto {
  @ApiProperty({ example: "team@palmlivingae.com" })
  @IsString()
  @MaxLength(500)
  externalId!: string;

  @ApiProperty({ example: "Palm Living — Design team" })
  @IsString()
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: ["inbound", "outbound", "bidirectional"] })
  @IsIn(["inbound", "outbound", "bidirectional"])
  direction!: "inbound" | "outbound" | "bidirectional";

  @ApiProperty({ type: "object", additionalProperties: true })
  @IsObject()
  configuration!: Record<string, unknown>;
}

export class CompleteGoogleConnectionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ example: "operations@palmlivingae.com" })
  @IsString()
  @MaxLength(255)
  externalAccountId!: string;

  @ApiProperty({ example: "palmlivingae.com" })
  @IsString()
  @MaxLength(255)
  @Matches(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  externalDomain!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  grantedScopes!: string[];

  @ApiProperty({ example: "redis:google:workspace-id:connection-id" })
  @IsString()
  @MaxLength(500)
  @Matches(/^redis:google:[0-9a-f-]{36}:[0-9a-f-]{36}$/i)
  secretReference!: string;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string | null;

  @ApiProperty({ type: [DiscoveredIntegrationResourceDto], maxItems: 250 })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => DiscoveredIntegrationResourceDto)
  resources!: DiscoveredIntegrationResourceDto[];
}

export class DiscoverIntegrationResourcesDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({ type: [DiscoveredIntegrationResourceDto], maxItems: 250 })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => DiscoveredIntegrationResourceDto)
  resources!: DiscoveredIntegrationResourceDto[];
}

export class CompleteProviderConnectionDto {
  @IsUUID()
  workspaceId!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(["quickbooks", "zoho_books", "whatsapp"])
  provider!: "quickbooks" | "zoho_books" | "whatsapp";

  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,255}$/)
  externalAccountId!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  grantedScopes!: string[];

  @IsString()
  @MaxLength(500)
  @Matches(/^redis:provider:(quickbooks|zoho_books|whatsapp):[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/i)
  secretReference!: string;

  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;

  @IsObject()
  configuration!: Record<string, unknown>;
}

export class AuthorizeIntegrationUseDto {
  @IsIn(["read", "write"])
  access!: "read" | "write";
}

export class IntegrationFailureDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ example: "oauth_access_denied" })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/i)
  errorCode!: string;
}

export class MarkIntegrationSyncedDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsDateString()
  syncedAt?: string;
}

export class RecordIntegrationHealthDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({ example: "provider.records.invoices" })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/i)
  operation!: string;

  @ApiProperty()
  @IsBoolean()
  succeeded!: boolean;

  @ApiPropertyOptional({ example: "provider_unavailable" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/i)
  errorCode?: string;
}

export class ReportIntegrationUseDto {
  @ApiProperty({ example: "provider.records.invoices" })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/i)
  operation!: string;

  @ApiProperty()
  @IsBoolean()
  succeeded!: boolean;

  @ApiPropertyOptional({ example: "provider_unavailable" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9_.-]*$/i)
  errorCode?: string;
}

export class RecordIntegrationActivityDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({
    enum: ["calendar.event_created", "calendar.event_updated", "calendar.event_cancelled", "invoice.create", "message.send", "email.send", "document.create", "accounting.invoice_refreshed", "provider.webhook_received"],
  })
  @IsIn(["calendar.event_created", "calendar.event_updated", "calendar.event_cancelled", "invoice.create", "message.send", "email.send", "document.create", "accounting.invoice_refreshed", "provider.webhook_received"])
  action!: string;

  @ApiProperty({ example: "google-event-id" })
  @IsString()
  @MaxLength(500)
  externalId!: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
