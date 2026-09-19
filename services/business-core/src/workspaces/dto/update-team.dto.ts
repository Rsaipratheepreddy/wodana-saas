import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class UpdateTeamDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String], format: "uuid" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  memberIds?: string[];

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadMembershipId?: string | null;

  @ApiPropertyOptional({ type: [String], format: "uuid" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String], format: "uuid" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  queueIds?: string[];
}
