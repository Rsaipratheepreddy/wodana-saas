import {Type,Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayUnique,IsArray,IsDateString,IsIn,IsInt,IsNumber,IsOptional,IsString,IsUUID,Max,MaxLength,Min,MinLength,ValidateNested} from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class ItemMaterialDto {
 @IsUUID() id!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) application!:string;
 @IsOptional() @IsUUID() materialId?:string|null;
 @IsOptional() @IsUUID() brandId?:string|null;
 @IsOptional() @IsUUID() finishId?:string|null;
 @IsString() @MaxLength(240) productName!:string;
 @IsString() @MaxLength(160) productCode!:string;
 @IsString() @MaxLength(160) finishCode!:string;
 @IsString() @MaxLength(160) stockSize!:string;
 @IsIn(['proposed','selected','change_requested','not_applicable']) status!:string;
 @IsString() @MaxLength(240) selectedBy!:string;
 @IsOptional() @IsDateString() selectedAt?:string|null;
 @IsString() @MaxLength(3000) evidence!:string;
 @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID(undefined,{each:true}) assetIds!:string[];
}
export class ItemDimensionDto {
 @IsUUID() id!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!:string;
 @IsIn(['mm','cm','m','in','ft']) unit!:string;
 @IsIn(['finished_item','site_opening','fabrication']) basis!:string;
 @IsOptional() @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) @Max(1e6) approximate?:number|null;
 @IsOptional() @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) @Max(1e6) measured?:number|null;
 @IsIn(['team','client']) source!:string;
 @IsString() @MaxLength(2000) evidence!:string;
}
export class ItemDesignReferenceDto {
 @IsUUID() versionId!:string;
 @IsIn(['2d','3d','reference']) usage!:string;
 @IsString() @MaxLength(120) sheet!:string;
}
export class SaveItemSpecificationDto {
 @IsInt() @Min(0) version!:number;
 @IsString() @MaxLength(6000) refinedRequirement!:string;
 @IsString() @MaxLength(6000) construction!:string;
 @IsString() @MaxLength(3000) inclusions!:string;
 @IsString() @MaxLength(3000) exclusions!:string;
 @IsString() @MaxLength(3000) assumptions!:string;
 @IsArray() @ArrayMaxSize(100) @ArrayUnique((r:ItemMaterialDto)=>r.id) @ValidateNested({each:true}) @Type(()=>ItemMaterialDto) materials!:ItemMaterialDto[];
 @IsArray() @ArrayMaxSize(40) @ArrayUnique((r:ItemDimensionDto)=>r.id) @ValidateNested({each:true}) @Type(()=>ItemDimensionDto) dimensions!:ItemDimensionDto[];
 @IsArray() @ArrayMaxSize(60) @ArrayUnique((r:ItemDesignReferenceDto)=>r.versionId) @ValidateNested({each:true}) @Type(()=>ItemDesignReferenceDto) designRefs!:ItemDesignReferenceDto[];
}
