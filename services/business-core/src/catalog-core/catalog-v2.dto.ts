import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

export class CreateCatalogDto {
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiPropertyOptional({ enum: ["sell", "buy", "reference"] }) @IsOptional() @IsIn(["sell", "buy", "reference"]) purpose?: "sell" | "buy" | "reference";
}
export class CreateCategoryDto {
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}
export class CreateAttributeDto {
  @ApiProperty() @IsString() @MaxLength(120) label!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ enum: ["text", "number", "choice", "multi_choice", "color", "boolean", "dimension"] })
  @IsIn(["text", "number", "choice", "multi_choice", "color", "boolean", "dimension"]) valueType!: "text" | "number" | "choice" | "multi_choice" | "color" | "boolean" | "dimension";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) unitCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) choices?: string[];
}
export class ItemDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiProperty() @IsString() @MaxLength(80) code!: string;
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiProperty({ enum: ["product", "material", "assembly", "service", "package", "ready_made"] })
  @IsIn(["product", "material", "assembly", "service", "package", "ready_made"]) itemType!: "product" | "material" | "assembly" | "service" | "package" | "ready_made";
  @ApiProperty() @IsString() @MaxLength(16) unitCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) wastePercent?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) purchaseRoundTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() values?: Record<string, unknown>;
  @ApiPropertyOptional({ description: "Working days to make one" }) @IsOptional() @IsInt() @Min(0) productionDays?: number;
  @ApiPropertyOptional({ description: "A link to the item's technical drawing; empty clears it" }) @IsOptional() @IsString() @MaxLength(2000) technicalDrawingUrl?: string | null;
}
export class ArchiveItemDto { @ApiProperty() @IsInt() @Min(1) version!: number; }
export class ComponentDto {
  @ApiProperty() @IsUUID() componentItemId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() componentVariantId?: string;
  @ApiProperty() @IsString() @MaxLength(500) quantityFormula!: string;
  @ApiProperty() @IsString() @MaxLength(16) unitCode!: string;
}
export class SetComponentsDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ type: [ComponentDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ComponentDto) components!: ComponentDto[];
}
export class CreatePriceBookDto {
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiProperty() @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() legalEntityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) segment?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string;
}
export class PriceBookStatusDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: ["active", "expired"] }) @IsIn(["active", "expired"]) status!: "active" | "expired";
}
class TierDto { @ApiProperty() @Matches(DECIMAL) fromQuantity!: string; @ApiProperty() @Matches(DECIMAL) price!: string; }
class SurchargeDto {
  @ApiProperty() @IsString() attributeCode!: string;
  @ApiProperty() @IsString() value!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) percent?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) label?: string;
}
export class PriceEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiProperty({ enum: ["fixed", "cost_plus", "per_measure", "tiered", "attribute_surcharge", "assembly_rollup"] })
  @IsIn(["fixed", "cost_plus", "per_measure", "tiered", "attribute_surcharge", "assembly_rollup"]) method!: "fixed" | "cost_plus" | "per_measure" | "tiered" | "attribute_surcharge" | "assembly_rollup";
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) price?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) cost?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) markupPercent?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) rate?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) minimumCharge?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) labour?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) marginPercent?: string;
  @ApiPropertyOptional({ type: [TierDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TierDto) tiers?: TierDto[];
  @ApiPropertyOptional({ type: [SurchargeDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SurchargeDto) surcharges?: SurchargeDto[];
}
export class ReviewPriceDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: ["reviewed", "active"] }) @IsIn(["reviewed", "active"]) decision!: "reviewed" | "active";
}
export class PricePreviewDto {
  @ApiProperty() @IsUUID() itemId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiProperty() @IsUUID() priceBookId!: string;
  @ApiProperty() @Matches(DECIMAL) quantity!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() quantityUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() attributes?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsObject() measurements?: Record<string, string>;
}

class ImportRowDto {
  @ApiProperty() @IsInt() @Min(1) line!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) sheet?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) itemType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() attributes?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) supplier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) cost?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}
export class ImportItemsDto {
  @ApiProperty({ enum: ["preview", "commit"] }) @IsIn(["preview", "commit"]) mode!: "preview" | "commit";
  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows!: ImportRowDto[];
}

export class AiCleanDto {
  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows!: ImportRowDto[];
}
