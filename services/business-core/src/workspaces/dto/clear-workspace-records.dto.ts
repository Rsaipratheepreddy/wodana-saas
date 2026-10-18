import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ClearWorkspaceRecordsDto {
  /** Must equal the workspace's slug; the database refuses anything else. */
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  confirmSlug!: string;

  /** Counts only. Defaults to true: deleting needs an explicit `false`. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
