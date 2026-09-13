import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { IsTimeZone } from "../../common/regional.validators";

export class CreateBusinessUnitDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  legalEntityId!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  parentBusinessUnitId?: string;

  @ApiProperty({ example: "DESIGN" })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,31}$/)
  code!: string;

  @ApiProperty({ example: "Design Studio" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ default: "studio" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type: string = "studio";

  @ApiProperty({ example: "Asia/Dubai" })
  @IsTimeZone()
  timezone!: string;

  @ApiPropertyOptional({ example: "#DC2626", default: "#64748B" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^#[0-9A-F]{6}$/)
  color?: string;
}
