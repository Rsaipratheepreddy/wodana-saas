import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { IsCountryCode, IsCurrencyCode, IsLocale, IsTimeZone } from "../../common/regional.validators";

export class UpdateLegalEntityDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  registeredName?: string;

  @ApiPropertyOptional({ example: "AE", minLength: 2, maxLength: 2 })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Length(2, 2)
  @IsCountryCode()
  countryCode?: string;

  @ApiPropertyOptional({ example: "AED", minLength: 3, maxLength: 3 })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsCurrencyCode()
  baseCurrency?: string;

  @ApiPropertyOptional({ example: "en-AE" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsLocale()
  locale?: string;

  @ApiPropertyOptional({ example: "Asia/Dubai" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxRegistrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}
