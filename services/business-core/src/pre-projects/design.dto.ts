import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsISO8601, ValidateNested, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";
const trim = ({value}:{value:unknown}) => typeof value === "string" ? value.trim() : value;
export const documentTypes = [
 "Concept / mood board","Material / finish board","Space plan / furniture layout","2D floor plan","Demolition / partition plan",
 "Reflected ceiling plan","Lighting plan","Power / data plan","Flooring / finish plan","Furniture / FF&E plan","Elevation","Section",
 "Joinery / millwork detail","Construction detail","3D model","3D render / visualization","Material / finish specification",
 "Door / hardware schedule","Fixture / equipment schedule","Signage / wayfinding","Code / egress plan","MEP coordination",
 "As-built / record drawing","Presentation / client approval","Other",
 // Retain validation for records created before the design-type taxonomy was expanded.
 "2D layout / space plan","3D render","Wall elevation","Material / finish selection","Furniture / joinery detail","Ceiling / electrical layout","Working drawing"
];
export class SaveDesignDto {
 @IsUUID() id!:string;
 @IsInt() @Min(0) version!:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(240) title!:string;
 @IsIn(documentTypes) documentType!:string;
 @IsString() @MaxLength(5000) description!:string;
 @IsOptional() @IsUUID() roomId?:string|null;
 @IsOptional() @IsUUID() scopeEntryId?:string|null;
 @IsOptional() @IsUUID() folderId?:string|null;
 @IsOptional() @IsBoolean() archived?:boolean;
}
export class AddDesignVersionDto {
 @IsUUID() id!:string;
 @IsInt() @Min(1) version!:number;
 @IsUUID() assetId!:string;
 @IsString() @MaxLength(5000) note!:string;
}
export class DesignActivityDto {
 @IsUUID() id!:string;
 @IsInt() @Min(1) version!:number;
 @IsUUID() versionId!:string;
 @IsIn(["comment","internal_review","internal_approved","client_review","approved","changes_requested"]) action!:string;
 @Transform(trim) @IsString() @MaxLength(5000) note!:string;
 @Transform(trim) @IsString() @MaxLength(240) decisionBy!:string;
 @IsOptional() @IsUUID() reviewerId?:string|null;
 @IsOptional() @IsIn(["email","meeting","phone","document"]) decisionSource?:string;
 @IsOptional() @IsISO8601() decisionAt?:string;
 @IsOptional() @IsBoolean() contextConfirmed?:boolean;
}

export class SaveDesignFolderDto {
 @IsUUID() id!:string;
 @IsInt() @Min(0) version!:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!:string;
 @IsString() @MaxLength(3000) description!:string;
 @IsOptional() @IsUUID() roomId?:string|null;
 @IsOptional() @IsUUID() scopeEntryId?:string|null;
}
class DesignUploadFileDto {
 @IsUUID() id!:string;
 @IsUUID() versionId!:string;
 @IsUUID() assetId!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(240) title!:string;
 @IsIn(documentTypes) documentType!:string;
 @IsOptional() @IsString() @MaxLength(5000) note?:string;
}
export class UploadDesignFilesDto {
 @IsOptional() @IsUUID() folderId?:string|null;
 @IsOptional() @IsUUID() roomId?:string|null;
 @IsOptional() @IsUUID() scopeEntryId?:string|null;
 @IsString() @MaxLength(5000) note!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique((f:DesignUploadFileDto)=>f.id) @ValidateNested({each:true}) @Type(()=>DesignUploadFileDto) files!:DesignUploadFileDto[];
}

export class CreateDesignThreadDto {
 @IsUUID() id!:string;
 @IsUUID() versionId!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(240) title!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) body!:string;
 @IsBoolean() blocking!:boolean;
}
export class ReplyDesignThreadDto {
 @IsUUID() id!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) body!:string;
}
export class ResolveDesignThreadDto {
 @IsInt() @Min(1) version!:number;
 @IsIn(['open','resolved']) status!:string;
}
