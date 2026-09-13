import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { IsCurrencyCode, IsLocale, IsTimeZone } from "../../common/regional.validators";
import { UnitSystem } from "./create-workspace.dto";

export class UpdateWorkspaceSettingsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: "AED" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsCurrencyCode()
  defaultCurrency?: string;

  @ApiPropertyOptional({ example: "en-AE" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsLocale()
  defaultLocale?: string;

  @ApiPropertyOptional({ example: "Asia/Dubai" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsTimeZone()
  defaultTimezone?: string;

  @ApiPropertyOptional({ enum: UnitSystem })
  @IsOptional()
  @IsEnum(UnitSystem)
  unitSystem?: UnitSystem;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;
}
