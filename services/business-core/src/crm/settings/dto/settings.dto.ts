import { Type } from "class-transformer";
import { Allow, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

export class TaxonomyOptionDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,78}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) label!: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}
export class CreateTaxonomyDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,78}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxonomyOptionDto) options?: TaxonomyOptionDto[];
}
export class UpdateTaxonomyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxonomyOptionDto) options?: TaxonomyOptionDto[];
}
export class CreateCustomFieldDto {
  @IsIn(["party", "enquiry", "lead", "opportunity", "activity"]) entityType!: string;
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,78}$/) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) label!: string;
  @IsIn(["text", "number", "boolean", "date", "datetime", "select", "multi_select", "party_reference"]) dataType!: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() searchable?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}
export class UpdateCustomFieldDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) label?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() searchable?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}
export class SetCustomFieldValueDto {
  @IsString() entityType!: string;
  @IsUUID() entityId!: string;
  @Allow() value!: unknown;
}
export class QualificationQuestionDto {
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,98}$/) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(240) label!: string;
  @IsIn(["text", "number", "boolean", "date", "select", "multi_select"]) dataType!: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsInt() @Min(0) position!: number;
  @IsOptional() @IsObject() scoring?: Record<string, unknown>;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}
export class CreateQualificationFormDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,78}$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(100) serviceType?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => QualificationQuestionDto) questions!: QualificationQuestionDto[];
}
export class UpdateQualificationFormDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(100) serviceType?: string | null;
  @IsOptional() @IsIn(["draft", "active", "archived"]) status?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QualificationQuestionDto) questions?: QualificationQuestionDto[];
}
export class CreateSavedViewDto {
  @IsIn(["parties", "leads", "opportunities", "activities", "conversations"]) entityType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsBoolean() isShared?: boolean;
  @IsObject() definition!: Record<string, unknown>;
}
export class UpdateSavedViewDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @IsOptional() @IsBoolean() isShared?: boolean;
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
}
export class ArchiveSettingDto { @IsInt() @Min(1) version!: number; }
