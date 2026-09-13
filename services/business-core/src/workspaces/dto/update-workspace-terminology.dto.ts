import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsString, Length, Matches, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const visibleText = /^[^\u0000-\u001F\u007F]+$/u;

export class UpdateWorkspaceTerminologyDto {
  @ApiProperty({ minimum: 0, description: "Use 0 when creating the first override" })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ example: "Department" })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  @Matches(visibleText)
  visibleName!: string;

  @ApiProperty({ example: "Departments" })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  @Matches(visibleText)
  visibleNamePlural!: string;
}
