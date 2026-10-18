import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const vendorCapabilities = [
  "materials",
  "services",
  "subcontracting",
  "manufacturing",
  "logistics",
  "other",
] as const;
export const vendorSiteTypes = ["branch", "store", "office", "warehouse", "factory", "other"] as const;

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const upper = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value;

export class ListVendorsQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) search?: string;
  @IsOptional() @IsIn(["draft", "active", "archived"]) status?: string;
  @IsOptional() @IsIn(vendorCapabilities) capability?: string;
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class CreateVendorDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) @Max(0) version!: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z0-9][A-Z0-9_-]{0,79}$/) code?: string;
  @Transform(trim) @IsString() @Length(1, 240) displayName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) legalName?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsIn(vendorCapabilities, { each: true }) capabilities: string[] = [];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) registrationNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) taxRegistrationNumber?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) defaultCurrency?: string;
  @IsOptional() @Transform(trim) @IsUrl({ protocols: ["https", "http"], require_protocol: true }) @MaxLength(500) website?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) notes = "";
}

export class UpdateVendorDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 240) displayName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) legalName?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsIn(vendorCapabilities, { each: true }) capabilities?: string[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) registrationNumber?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) taxRegistrationNumber?: string | null;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) defaultCurrency?: string | null;
  @IsOptional() @Transform(trim) @IsUrl({ protocols: ["https", "http"], require_protocol: true }) @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) notes?: string;
}

export class VendorLifecycleDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["activate", "archive", "restore"]) action!: "activate" | "archive" | "restore";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}

export class CreateVendorSiteDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) @Max(0) version!: number;
  @Transform(trim) @IsString() @Length(1, 180) name!: string;
  @IsIn(vendorSiteTypes) siteType!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(180) contactName?: string;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) addressLine1?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) addressLine2?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) locality?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) region?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) postalCode?: string;
  @IsOptional() @Transform(upper) @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsBoolean() isPrimary = false;
}

export class UpdateVendorSiteDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 180) name?: string;
  @IsOptional() @IsIn(vendorSiteTypes) siteType?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(180) contactName?: string | null;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(320) email?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) phone?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) addressLine1?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) addressLine2?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) locality?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) region?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) postalCode?: string | null;
  @IsOptional() @Transform(upper) @IsString() @Length(2, 2) countryCode?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class VendorSiteLifecycleDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["archive", "restore"]) action!: "archive" | "restore";
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
}


export class ImportVendorRowDto extends CreateVendorDto {
  @IsInt() @Min(2) @Max(5001) sourceRow!: number;
  @IsUUID() siteId!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(180) contactName?: string;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @Transform(trim) @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
}
export class ImportVendorsDto {
  @IsIn(["preview", "commit"]) mode!: "preview" | "commit";
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>ImportVendorRowDto)
  rows!: ImportVendorRowDto[];
}
