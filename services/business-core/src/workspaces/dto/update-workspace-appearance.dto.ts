import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Min, ValidateIf } from "class-validator";

/** The brand fonts a workspace may choose (the tenant_login_branding font checks hold the same lists). */
export const HEADING_FONTS = ["alta"] as const;
export const BODY_FONTS = ["montserrat"] as const;

const normalizeHex =({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toUpperCase() : value;

export class UpdateWorkspaceAppearanceDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  workspaceVersion!: number;

  @ApiPropertyOptional({
    example: "#0B7F5D",
    nullable: true,
    description: "Six-digit workspace brand colour. Null restores the Wodana default.",
  })
  @Transform(normalizeHex)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9A-F]{6}$/)
  primaryColor!: string | null;

  @ApiPropertyOptional({ example: "#000000", nullable: true })
  @IsOptional()
  @Transform(normalizeHex)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9A-F]{6}$/)
  secondaryColor?: string | null;

  @ApiPropertyOptional({ enum: HEADING_FONTS, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsIn(HEADING_FONTS)
  headingFont?: typeof HEADING_FONTS[number] | null;

  @ApiPropertyOptional({ enum: BODY_FONTS, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsIn(BODY_FONTS)
  bodyFont?: typeof BODY_FONTS[number] | null;
}
