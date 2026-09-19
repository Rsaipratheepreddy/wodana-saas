import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  MaxLength,
  MinLength,
} from "class-validator";

export class InviteMemberDto {
  @ApiPropertyOptional({ description: "Name shown in the member directory after activation" })
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName?: string;

  @ApiProperty({ format: "email" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email!: string;

  @ApiProperty({ type: [String], example: ["viewer"], description: "Direct roles. May be empty when teams provide access." })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes!: string[];

  @ApiPropertyOptional({ type: [String], format: "uuid", description: "Teams joined on invitation activation" })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  teamIds: string[] = [];
}
