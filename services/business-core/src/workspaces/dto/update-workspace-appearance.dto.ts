import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsString, Matches, Min, ValidateIf } from "class-validator";

const normalizeHex = ({ value }: { value: unknown }) =>
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
}
