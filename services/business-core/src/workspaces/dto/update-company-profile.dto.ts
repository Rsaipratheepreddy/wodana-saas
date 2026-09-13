import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { IsCountryCode, IsCurrencyCode, IsLocale, IsTimeZone } from "../../common/regional.validators";
import { UnitSystem } from "./create-workspace.dto";

class CompanyAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(160)
  line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(160)
  line2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(32)
  postalCode?: string;
}

export class UpdateCompanyProfileDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  workspaceVersion!: number;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  legalEntityVersion!: number;

  @ApiProperty({ example: "Iglo Architects" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: "Iglo Architects LLC" })
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

  @ApiProperty({ example: "AED" })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsCurrencyCode()
  defaultCurrency!: string;

  @ApiProperty({ example: "en-AE" })
  @Transform(({ value }) => String(value).trim())
  @IsLocale()
  defaultLocale!: string;

  @ApiProperty({ example: "Asia/Dubai" })
  @Transform(({ value }) => String(value).trim())
  @IsTimeZone()
  defaultTimezone!: string;

  @ApiProperty({ enum: UnitSystem })
  @IsEnum(UnitSystem)
  unitSystem!: UnitSystem;

  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MaxLength(100)
  taxRegistrationNumber?: string;

  @ApiPropertyOptional({ type: () => CompanyAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyAddressDto)
  address?: CompanyAddressDto;
}
