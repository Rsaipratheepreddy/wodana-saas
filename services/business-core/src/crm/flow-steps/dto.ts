import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

/** E2-5 / PLM-081: mark a step not needed, with the reason. */
export class SkipStepDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsOptional() @IsUUID() commandId?: string;
}

export class UnskipStepDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** E2-3: move running jobs to the latest version of their steps. */
export class MigrateJobsDto {
  @IsInt() @Min(1) @Max(1_000_000) toVersion!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID("all", { each: true }) opportunityIds!: string[];
}

/** PLM-080 / PLM-044: book the joinery site visit for the salesperson and a designer. */
export class BookSiteVisitDto {
  @IsUUID() designerMembershipId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @IsOptional() @IsInt() @Min(30) @Max(480) minutes?: number;
  @IsString() @MinLength(1) @MaxLength(64) timezone!: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  /** The site visit's version the person saw (0 before it exists). */
  @IsInt() @Min(0) version!: number;
}
