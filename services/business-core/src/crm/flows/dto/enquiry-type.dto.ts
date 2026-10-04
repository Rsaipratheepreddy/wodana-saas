import { Equals, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { FLOW_TEMPLATE_KEYS } from "../flow-templates";

/** A new enquiry type with its steps: from a library template, a copy of another type's steps, or blank (exactly one). */
export class CreateEnquiryTypeDto {
  @IsString() @MinLength(1) @MaxLength(160) label!: string;
  /** One of the six chart hues; absent or null uses the colour derived from the type's code. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(6) color?: number | null;
  @IsOptional() @IsIn(FLOW_TEMPLATE_KEYS) templateKey?: string;
  @IsOptional() @IsUUID() copyFromTypeId?: string;
  @IsOptional() @Equals(true) blank?: true;
}

/** Rename, recolour, archive or restore an enquiry type; `version` is the type's version. */
export class UpdateEnquiryTypeDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) label?: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(6) color?: number | null;
  @IsOptional() @IsIn(["active", "archived"]) status?: "active" | "archived";
}
