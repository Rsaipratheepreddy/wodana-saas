import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class SaveDiscoveryDto {
  @IsOptional() @IsInt() @Min(0) version?: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @Matches(/^\d{1,8}(\.\d{1,2})?$/) area?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsIn(["sqft", "sqm"]) areaUnit?: "sqft" | "sqm" | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(500) spaces?: number | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(240) propertyLocation?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(254) clientEmail?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() floorPlanAssetId?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() designPackageId?: string | null;
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}
