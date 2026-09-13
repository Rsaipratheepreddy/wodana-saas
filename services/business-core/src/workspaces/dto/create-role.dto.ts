import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayUnique, IsArray, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateRoleDto {
  @ApiProperty({ example: "lead_designer" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @Matches(/^[a-z][a-z0-9_-]{1,63}$/)
  code!: string;

  @ApiProperty({ example: "Lead Designer" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ default: "" })
  @IsString()
  @MaxLength(500)
  description: string = "";

  @ApiProperty({ type: [String], example: ["legal_entities.view"] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes!: string[];
}
