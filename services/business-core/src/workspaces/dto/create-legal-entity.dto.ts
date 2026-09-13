import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  IsCountryCode,
  IsCurrencyCode,
  IsLocale,
  IsTimeZone,
} from "../../common/regional.validators";

export class CreateLegalEntityDto {
  @ApiProperty({ example: "PALM" })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,23}$/)
  code!: string;

  @ApiProperty({ example: "Palm Living" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ApiProperty({ example: "Palm Living LLC" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  registeredName!: string;

  @ApiProperty({ example: "AE", minLength: 2, maxLength: 2 })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Length(2, 2)
  @IsCountryCode()
  countryCode!: string;

  @ApiProperty({ example: "AED", minLength: 3, maxLength: 3 })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Length(3, 3)
  @IsCurrencyCode()
  baseCurrency!: string;

  @ApiProperty({ example: "en-AE" })
  @Transform(({ value }) => String(value).trim())
  @IsLocale()
  locale!: string;

  @ApiProperty({ example: "Asia/Dubai" })
  @Transform(({ value }) => String(value).trim())
  @IsTimeZone()
  timezone!: string;

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
