import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

const providers = ["google_workspace", "quickbooks", "zoho_books", "whatsapp", "payment", "custom"] as const;

export class CreateIntegrationConnectionDto {
  @ApiProperty({ enum: providers, example: "google_workspace" })
  @IsIn(providers)
  provider!: (typeof providers)[number];

  @ApiProperty({ example: "Palm Living Google Workspace" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  legalEntityId?: string;

  @ApiPropertyOptional({ example: "palmlivingae.com" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsString()
  @MaxLength(255)
  @Matches(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  externalDomain?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}
