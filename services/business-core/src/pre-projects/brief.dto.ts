import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import type { NoteDocument } from '../crm/leads/note-document';

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class SaveBriefDto {
  @IsOptional() @IsString() @MaxLength(3) currencyCode?:string;
  @IsOptional() @IsString() @MaxLength(30) budgetAmount?:string;

  @IsInt() @Min(0) version!: number;
  @IsString() @MaxLength(6000) goals!: string;
  @IsString() @MaxLength(240) propertyType!: string;
  @IsString() @MaxLength(1000) location!: string;
  @IsString() @MaxLength(120) area!: string;
  @IsString() @MaxLength(500) budget!: string;
  @IsString() @MaxLength(500) timeline!: string;
  @IsString() @MaxLength(1000) decisionMakers!: string;
  @IsString() @MaxLength(3000) people!: string;
  @IsString() @MaxLength(3000) preferences!: string;
  @IsString() @MaxLength(3000) retainedItems!: string;
  @IsString() @MaxLength(3000) exclusions!: string;
  @IsString() @MaxLength(3000) constraints!: string;
}

export class SaveRoomDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) version!: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() catalogRecordId?: string | null;
}

export class ScopeLinkDto {
  @IsIn(["work","variant","material","brand","finish","unit","execution"]) role!: string;
  @IsUUID() recordId!: string;
}

export class SaveBriefEntryDto {
  @IsOptional() @IsObject() document?: NoteDocument;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @ArrayUnique((link: ScopeLinkDto) => link.role) @ValidateNested({each:true}) @Type(() => ScopeLinkDto) catalogLinks?: ScopeLinkDto[];
  @IsUUID() id!: string;
  @IsInt() @Min(0) version!: number;
  @IsIn(["requirement", "note", "inspiration", "file"]) kind!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsOptional() @IsUUID() roomId?: string | null;
  @IsString() @MaxLength(60000) note!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) category!: string;
  @IsIn(["must_have", "preferred", "optional"]) priority!: string;
  @IsIn(["included", "excluded", "undecided"]) scopeStatus!: string;
  @IsIn(["captured", "reviewed", "clarification"]) reviewStatus!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0.0001) @Max(1e9) quantity?: number | null;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsString() @MaxLength(2000) @ValidateIf((_object, value) => value !== "")
  @IsUrl({ protocols: ["http", "https"], require_protocol: true, require_tld: false }) referenceUrl!: string;
  @IsString() @MaxLength(3000) avoid!: string;
  @IsIn(["team", "client"]) source!: string;
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID(undefined, { each: true }) assetIds!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsUUID(undefined, { each: true }) requirementIds?: string[];
}

export class MoodboardPinDto {
  @IsUUID() entryId!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-20000) @Max(20000) x!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-20000) @Max(20000) y!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(120) @Max(960) width!: number;
  @IsInt() @Min(0) @Max(100000) z!: number;
  @IsIn(["love", "avoid"]) sentiment!: "love" | "avoid";
}

export class MoodboardLayoutDto {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => MoodboardPinDto) pins!: MoodboardPinDto[];
}

export class ArchiveBriefEntryDto {
  @IsInt() @Min(1) version!: number;
  @IsBoolean() archived!: boolean;
}

export class BulkBriefEntriesDto {
 @IsArray() @ArrayMaxSize(100) @ArrayUnique((entry:SaveBriefEntryDto)=>entry.id) @ValidateNested({each:true}) @Type(()=>SaveBriefEntryDto) entries!:SaveBriefEntryDto[];
}
