import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from "class-validator";

export class UpdateIntegrationConnectionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  legalEntityId?: string | null;

  @ApiPropertyOptional({ type: String, example: "palmlivingae.com", nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }) => value === null ? null : String(value).trim().toLowerCase())
  @IsString()
  @MaxLength(255)
  @Matches(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  externalDomain?: string | null;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}
