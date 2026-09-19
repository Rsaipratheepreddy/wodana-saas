import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class PlatformLoginDto {
  @ApiProperty({ format: "email" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class PlatformChallengeDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  challengeToken!: string;
}

export class PlatformFactorDto extends PlatformChallengeDto {
  @ApiProperty({ description: "Authenticator code or recovery code" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string;
}
