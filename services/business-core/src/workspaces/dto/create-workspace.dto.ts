import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { IsCurrencyCode, IsLocale, IsTimeZone } from "../../common/regional.validators";
import { CreateLegalEntityDto } from "./create-legal-entity.dto";

export enum UnitSystem {
  Metric = "metric",
  Imperial = "imperial",
  Mixed = "mixed",
}

export class CreateWorkspaceDto {
  @ApiProperty({ example: "Palm Living" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ example: "palm-living" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug?: string;

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

  @ApiProperty({ enum: UnitSystem, example: UnitSystem.Metric })
  @IsEnum(UnitSystem)
  unitSystem!: UnitSystem;

  @ApiProperty({ minimum: 0, maximum: 6, default: 1 })
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn: number = 1;

  @ApiProperty({ type: () => CreateLegalEntityDto })
  @ValidateNested()
  @Type(() => CreateLegalEntityDto)
  firstLegalEntity!: CreateLegalEntityDto;
}
