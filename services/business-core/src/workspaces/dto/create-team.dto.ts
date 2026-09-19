import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateTeamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  businessUnitId!: string;

  @ApiProperty({ example: "STUDIO_A" })
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,31}$/)
  code!: string;

  @ApiProperty({ example: "Studio A" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

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
  memberIds: string[] = [];

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  leadMembershipId?: string;

  @ApiPropertyOptional({ type: [String], format: "uuid", description: "Roles inherited by every active team member" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  roleIds: string[] = [];

  @ApiPropertyOptional({ type: [String], format: "uuid", description: "Lead queues inherited by every active team member" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  queueIds: string[] = [];
}
