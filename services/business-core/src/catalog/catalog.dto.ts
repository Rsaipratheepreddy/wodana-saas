import { Type, Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, IsUrl, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { catalogKinds } from "./catalog-structure";

export { catalogKinds };
export type CatalogKind = typeof catalogKinds[number];
const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
export class CatalogAttributeDto {
  @Transform(trim) @IsString() @Length(1, 80) name: string;
  @Transform(trim) @IsString() @Length(1, 1000) value: string;
}
export class CatalogSizeDto {
  @Transform(trim) @IsString() @Length(1, 160) label: string;
  @IsOptional() @IsNumber() @Min(0.001) @Max(1000000) lengthMm?: number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(1000000) widthMm?: number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(1000000) thicknessMm?: number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(1000000) diameterMm?: number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(1000000) packQuantity?: number;
  @IsOptional() @IsIn(["L", "ml", "kg", "g", "m", "each"]) packUnit?: string;
  @IsOptional() @IsUrl({ protocols: ["https", "http"], require_protocol: true }) @MaxLength(2000) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class CatalogSourceDto {
  @Transform(trim) @IsString() @Length(1, 160) title: string;
  @IsUrl({ protocols: ["https", "http"], require_protocol: true }) @MaxLength(2000) url: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) checkedOn: string;
}
export class CatalogLinkDto {
  @IsIn([...catalogKinds,"parent","related"]) relation: string;
  @IsUUID() targetId: string;
}
export class CatalogCommerceDto {
  @IsIn(["unpriced", "fixed", "on_request"])
  pricingMode: "unpriced" | "fixed" | "on_request";
}
export class CatalogProvenanceDto {
  @Transform(trim) @Matches(/^[a-z0-9][a-z0-9._:-]{0,119}$/) namespace: string;
  @Transform(trim) @IsString() @Length(1, 300) sourceKey: string;
  @Matches(/^[0-9a-f]{64}$/) sourceFingerprint: string;
  @IsIn(["needs_review", "approved", "rejected"])
  reviewStatus: "needs_review" | "approved" | "rejected";
  @IsOptional() @Transform(trim) @IsString() @Length(1, 240) sourceFileName?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) sourceSheet?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) sourceRow?: number;
}
export class SaveCatalogRecordDto {
  @IsOptional() @IsUUID() catalogId?:string;
  @IsUUID() id: string;
  @IsInt() @Min(0) version: number;
  @IsIn(catalogKinds) kind: CatalogKind;
  @Transform(trim) @Matches(/^[A-Z0-9][A-Z0-9_-]{0,79}$/) code: string;
  @Transform(trim) @IsString() @Length(1, 180) name: string;
  @Transform(trim) @IsString() @MaxLength(4000) description: string;
  @IsIn(["IN", "AE", "GLOBAL", "CUSTOM"]) market: string;
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) aliases: string[];
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CatalogAttributeDto) attributes: CatalogAttributeDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CatalogSizeDto) sizes: CatalogSizeDto[];
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => CatalogSourceDto) sources: CatalogSourceDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CatalogLinkDto) links: CatalogLinkDto[];
  @IsIn(["reference", "needs_specification", "workspace_verified"]) specificationStatus: string;
  @IsIn(["none", "length", "area", "volume", "mass", "count", "time", "pack", "reference"]) dimension: string;
  @IsOptional() @IsNumber() @Min(0.000000001) @Max(1000000000) baseFactor?: number;
  @IsOptional() @IsObject() configuration?: Record<string,string|number>;
  @IsOptional() @ValidateNested() @Type(() => CatalogCommerceDto) commerce?: CatalogCommerceDto;
  @IsOptional() @ValidateNested() @Type(() => CatalogProvenanceDto) provenance?: CatalogProvenanceDto;
}
export class ArchiveCatalogDto {
  @IsInt() @Min(1) version: number;
  @IsBoolean() archived: boolean;
}
export class RecipeValueDto {
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/) key:string;
  @IsNumber() @Min(0) @Max(100000000) value:number;
}
export class RecipeSelectionDto {
  @IsUUID() slotId:string;
  @IsUUID() targetId:string;
}
export class RecipeSurveyBindingDto {
  @IsIn(["width","height","length","depth"]) axis:"width"|"height"|"length"|"depth";
  @IsUUID() dimensionId:string;
}
export class RecipeSurveyAdjustmentDto {
  @IsIn(["width","height","length","depth"]) axis:"width"|"height"|"length"|"depth";
  @IsNumber() @Min(0.001) @Max(100000) value:number;
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(500) reason:string;
}
export class RecipeSurveySourceDto {
  @IsUUID() caseId:string;
  @IsUUID() entryId:string;
  @IsUUID() measurementId:string;
  @IsInt() @Min(1) measurementVersion:number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique((row:RecipeSurveyBindingDto)=>row.axis) @ValidateNested({each:true}) @Type(()=>RecipeSurveyBindingDto) bindings:RecipeSurveyBindingDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ArrayUnique((row:RecipeSurveyAdjustmentDto)=>row.axis) @ValidateNested({each:true}) @Type(()=>RecipeSurveyAdjustmentDto) adjustments?:RecipeSurveyAdjustmentDto[];
}
export class RecipePreviewDto {
  @IsUUID() templateId:string;
  @IsUUID() executionId:string;
  @IsOptional() @IsUUID() variantId?:string;
  @IsOptional() @IsUUID() roomId?:string;
  @IsOptional() @IsUUID() rateZoneId?:string;
  @IsOptional() @IsUUID() taxId?:string;
  @IsIn(["Standard","Premium","Luxury"]) grade:string="Standard";
  @IsIn(["ft","m","mm"]) dimensionUnit:"ft"|"m"|"mm"="ft";
  @IsNumber() @Min(0.001) @Max(10000) quantity:number=1;
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) width?:number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) height?:number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) length?:number;
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) depth?:number;
  @Matches(/^[A-Z]{3}$/) currency:string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) pricingDate?:string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>RecipeValueDto) values?:RecipeValueDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>RecipeSelectionDto) selections?:RecipeSelectionDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID(undefined,{each:true}) commercialRuleIds?:string[];
  @IsOptional() @ValidateNested() @Type(()=>RecipeSurveySourceDto) survey?:RecipeSurveySourceDto;
}

export class CreateCatalogDto {
  @IsUUID() id:string;
  @Transform(trim) @IsString() @Length(1,180) name:string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) description:string="";
  @IsOptional() @IsUUID() sourceCatalogId?:string;
  @IsOptional() @IsBoolean() starter:boolean=true;
}

export class CatalogTargetDto { @IsOptional() @IsUUID() catalogId?:string; }

export class CatalogVersionDto {
  @IsUUID() id: string;
  @IsInt() @Min(1) version: number;
}
export class OrganizeCatalogDto {
  @IsUUID() catalogId: string;
  @IsIn(["move", "reorder"]) action: "move" | "reorder";
  @IsOptional() @IsUUID() groupId?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CatalogVersionDto) records: CatalogVersionDto[];
}

export class ImportCatalogDto {
  @IsUUID() catalogId: string;
  @IsOptional() @IsBoolean() dryRun: boolean = false;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>SaveCatalogRecordDto)
  records: SaveCatalogRecordDto[];
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({each:true}) @Type(()=>CatalogVersionDto)
  references: CatalogVersionDto[];
}

export class CatalogAssetUploadQueryDto {
  @IsIn(["primary_image", "gallery_image", "technical_drawing"])
  role: "primary_image" | "gallery_image" | "technical_drawing" = "gallery_image";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) altText?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) sortOrder?: number;
}

export class UpdateCatalogAssetDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsIn(["primary_image", "gallery_image", "technical_drawing"])
  role?: "primary_image" | "gallery_image" | "technical_drawing";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) altText?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) sortOrder?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 500) archivedReason?: string;
}
