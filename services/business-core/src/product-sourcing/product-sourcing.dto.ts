import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from "class-validator";

const SIZE = /^\d{1,8}(\.\d{1,2})?$/;
const UNITS = ["mm", "cm", "m", "in", "ft"];

export class ReadClipDto {
  @ApiProperty() @IsUUID() clipId!: string;
  @ApiProperty() @IsUUID() catalogId!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(2000) url!: string;
}

export class SaveClipDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @MaxLength(80) code!: string;
  @ApiProperty({ enum: ["product", "material", "ready_made"] }) @IsIn(["product", "material", "ready_made"]) itemType!: "product" | "material" | "ready_made";
  @ApiProperty() @IsString() @MaxLength(16) unitCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string | null;
  /** Final value per field as the person reviewed it; null or "" rejects a proposal. */
  @ApiProperty() @IsObject() values!: Record<string, string | null>;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsUUID(undefined, { each: true }) imageIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string | null;
}

export class VersionDto { @ApiProperty() @IsInt() @Min(1) version!: number; }

export class ItemDimensionsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) width?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) depth?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) height?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) diagonalDepth?: string | null;
  @ApiProperty({ enum: UNITS }) @IsIn(UNITS) unit!: string;
}

export class LinkPreviewDto { @ApiProperty() @IsString() @MinLength(8) @MaxLength(2000) url!: string; }

export class AccessPointDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) route!: string;
  @ApiProperty() @IsInt() @Min(0) position!: number;
  @ApiProperty({ enum: ["door", "lift", "stair", "corridor", "window", "other"] }) @IsIn(["door", "lift", "stair", "corridor", "window", "other"]) kind!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) width?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) height?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) turnWidth?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) cabinWidth?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) cabinDepth?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(SIZE) cabinHeight?: string | null;
  @ApiProperty({ enum: UNITS }) @IsIn(UNITS) unit!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteRecordId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class FitCheckDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) itemIds!: string[];
}

export class FitOverrideDto {
  @ApiProperty() @IsUUID() id!: string;
  @ApiProperty() @IsUUID() itemId!: string;
  @ApiProperty() @Matches(/^[0-9a-f]{64}$/) inputsHash!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @ApiProperty({ enum: ["approval", "ordering"] }) @IsIn(["approval", "ordering"]) context!: "approval" | "ordering";
}
