import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import { COMPANY_LOGO_MIME_TYPES } from "./company-logo.dto";

/** A full-screen photograph behind the tenant sign-in screen: the logo's image types, a larger size. */
export const LOGIN_BACKGROUND_MIME_TYPES = COMPANY_LOGO_MIME_TYPES;
export const LOGIN_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;

export class InitiateLoginBackgroundUploadDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: LOGIN_BACKGROUND_MIME_TYPES })
  @IsIn(LOGIN_BACKGROUND_MIME_TYPES)
  mimeType!: typeof LOGIN_BACKGROUND_MIME_TYPES[number];

  @ApiProperty({ minimum: 1, maximum: LOGIN_BACKGROUND_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(LOGIN_BACKGROUND_MAX_BYTES)
  byteSize!: number;
}
