import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class SaveDiscoveryDto {
  @IsOptional() @IsInt() @Min(0) version?: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @Matches(/^\d{1,8}(\.\d{1,2})?$/) area?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsIn(["sqft", "sqm"]) areaUnit?: "sqft" | "sqm" | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(500) spaces?: number | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(240) propertyLocation?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(254) clientEmail?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() floorPlanAssetId?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() designPackageId?: string | null;
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}

export class BookIntroDto {
  @IsUUID() designerMembershipId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string;
  @IsString() @MaxLength(64) timezone!: string;
  @IsIn(["in_person", "online"]) mode!: "in_person" | "online";
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) place?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) changeReason?: string | null;
}

export class ChangeDesignerDto {
  @IsUUID() membershipId!: string;
  @IsString() @MaxLength(500) reason!: string;
  @IsInt() @Min(0) version!: number;
}
