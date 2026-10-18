import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class TaxRateDto {
  @ApiProperty() @IsString() @MaxLength(40) code!: string;
  @ApiProperty() @IsString() @MaxLength(80) label!: string;
  @ApiProperty({ description: "Percentage as a decimal string, e.g. \"5\" or \"12.5\"" }) @IsString() @MaxLength(9) rate!: string;
  @ApiProperty() @IsBoolean() isDefault!: boolean;
}

export class SaveTaxSettingsDto {
  @ApiPropertyOptional({ description: "Current version; omit when tax is not configured yet" }) @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiProperty() @IsBoolean() pricesIncludeTax!: boolean;
  @ApiProperty({ type: [TaxRateDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TaxRateDto) rates!: TaxRateDto[];
}

export class SaveNumberingDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
  @ApiProperty() @IsString() @MaxLength(40) prefix!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) suffix?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) padding!: number;
  @ApiProperty({ enum: ["never", "annual"] }) @IsIn(["never", "annual"]) resetPolicy!: "never" | "annual";
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) nextNumber?: number;
}
