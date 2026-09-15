import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const supplierOfferSources = ["vendor_quote", "price_list", "contract", "verbal_confirmation", "estimate", "included"] as const;
export const supplierOfferTaxTreatments = ["unconfirmed", "exclusive", "inclusive", "not_applicable"] as const;
export const supplierOfferInclusions = ["delivery", "unloading", "installation", "packaging", "warranty", "other"] as const;

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const upper = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toUpperCase() : value;

export class ListSupplierOffersQueryDto {
  @IsOptional() @IsIn(["draft", "active", "archived"]) status?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() catalogRecordId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) search?: string;
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class ApplicableSupplierOffersQueryDto {
  @IsUUID() catalogRecordId!: string;
  @IsUUID() unitRecordId!: string;
  @Transform(upper) @Matches(/^[A-Z]{3}$/) currency!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) quantity!: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validOn?: string;
}

export class CreateSupplierOfferDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) @Max(0) version!: number;
  @IsUUID() vendorId!: string;
  @IsOptional() @IsUUID() vendorSiteId?: string;
  @IsUUID() catalogRecordId!: string;
  @IsOptional() @IsUUID() unitRecordId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) supplierSku?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1_000_000_000_000) amount?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) quantityFrom?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) minimumOrderQuantity?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) orderMultiple?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string;
  @IsOptional() @IsIn(supplierOfferSources) sourceType?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) sourceReference?: string;
  @IsOptional() @IsIn(supplierOfferTaxTreatments) taxTreatment = "unconfirmed";
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsIn(supplierOfferInclusions, { each: true }) inclusions: string[] = [];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) terms = "";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) notes = "";
}

export class UpdateSupplierOfferDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsUUID() vendorSiteId?: string | null;
  @IsOptional() @IsUUID() unitRecordId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) supplierSku?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1_000_000_000_000) amount?: number | null;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) quantityFrom?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) minimumOrderQuantity?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000_000) orderMultiple?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string | null;
  @IsOptional() @IsIn(supplierOfferSources) sourceType?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) sourceReference?: string | null;
  @IsOptional() @IsIn(supplierOfferTaxTreatments) taxTreatment?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsIn(supplierOfferInclusions, { each: true }) inclusions?: string[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) terms?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) notes?: string;
}

export class SupplierOfferLifecycleDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsIn(["activate", "archive", "restore"]) action!: "activate" | "archive" | "restore";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}
