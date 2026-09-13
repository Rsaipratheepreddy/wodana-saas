import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from "class-validator";

export const COMPANY_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const COMPANY_LOGO_MAX_BYTES = 5 * 1024 * 1024;

export class InitiateCompanyLogoUploadDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: COMPANY_LOGO_MIME_TYPES })
  @IsIn(COMPANY_LOGO_MIME_TYPES)
  mimeType!: typeof COMPANY_LOGO_MIME_TYPES[number];

  @ApiProperty({ minimum: 1, maximum: COMPANY_LOGO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(COMPANY_LOGO_MAX_BYTES)
  byteSize!: number;
}
