import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MinLength } from "class-validator";

export class AcceptInvitationDto {
  @ApiProperty({ minLength: 32, description: "One-time invitation token" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(32)
  token!: string;
}
