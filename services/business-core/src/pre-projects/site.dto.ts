import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ItemDimensionDto } from './item-specification.dto';

const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SiteRecordDto {
 @IsUUID() id!:string;
 @IsInt() @Min(0) version!:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(240) title!:string;
 @IsString() @MaxLength(6000) note!:string;
 @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID(undefined,{each:true}) assetIds!:string[];
}
export class SiteLocationDto extends SiteRecordDto {
 @IsOptional() @IsUUID() roomId?:string|null;
 @IsOptional() @IsUUID() entryId?:string|null;
 @IsOptional() @IsUUID() visitId?:string|null;
}
export class SaveSiteVisitDto extends SiteRecordDto {
 @IsDateString() scheduledAt!:string;
 @IsString() @MaxLength(64) timezone!:string;
 @IsInt() @Min(15) @Max(1440) durationMinutes!:number;
 @IsOptional() @IsUUID() assigneeId?:string|null;
 @IsString() @MaxLength(1000) location!:string;
 @IsString() @MaxLength(3000) access!:string;
 @IsIn(['planned','completed','cancelled']) status!:string;
 @IsString() @MaxLength(3000) outcome!:string;
}
export class SaveSiteObservationDto extends SiteLocationDto {
 @IsIn(['condition','opening','electrical','plumbing','access','constraint','other']) category!:string;
 @IsIn(['open','resolved']) status!:string;
 @IsString() @MaxLength(3000) resolution!:string;
}
export class SaveSiteMeasurementDto extends SiteLocationDto {
 @IsInt() @Min(0) specificationVersion!:number;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ArrayUnique((d:ItemDimensionDto)=>d.id) @ValidateNested({each:true}) @Type(()=>ItemDimensionDto) dimensions!:ItemDimensionDto[];
}
export class ReviewSiteMeasurementDto {
 @IsInt() @Min(1) version!:number;
 @IsIn(['verified','recheck']) status!:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(3000) note!:string;
}
