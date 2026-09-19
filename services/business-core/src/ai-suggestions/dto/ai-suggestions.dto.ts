import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreateAiSuggestionDto {
  @IsUUID() requestId!: string;
  @IsIn(["lead", "opportunity", "commercial_case", "project"]) entityType!: "lead" | "opportunity" | "commercial_case" | "project";
  @IsUUID() entityId!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(12_000) suggestionText!: string;
  @IsArray() @ArrayMaxSize(40) @IsObject({ each: true }) evidence!: Array<Record<string, unknown>>;
  @IsArray() @ArrayMaxSize(30) @IsObject({ each: true }) proposedDiff!: Array<Record<string, unknown>>;
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(500, { each: true }) uncertainty!: string[];
  @IsObject() provenance!: Record<string, unknown>;
}

export class DecideAiSuggestionDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsIn(["accepted", "edited", "rejected"]) action!: "accepted" | "edited" | "rejected";
  @IsOptional() @IsString() @MaxLength(12_000) editedText?: string;
  @IsOptional() @IsString() @MaxLength(1_000) reason?: string;
}
