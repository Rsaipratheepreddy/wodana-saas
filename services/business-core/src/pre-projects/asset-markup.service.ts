import {BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, ParseUUIDPipe, Post} from '@nestjs/common';
import {Type} from 'class-transformer';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsUUID, Matches, Max, Min, ValidateNested} from 'class-validator';
import {createHash} from 'node:crypto';
import sharp from "sharp";
import {RequestActor} from '../auth/actor';
import {CurrentActor} from '../auth/current-actor.decorator';
import {WorkspaceAccessService} from '../workspaces/workspace-access.service';
import {BrandAssetStorageService} from '../workspaces/brand-asset-storage.service';
import {CrmEventsService} from '../crm/shared/crm-events.service';
import {BriefService} from './brief.service';
class PointDto { @IsNumber() @Min(0) @Max(1) x!:number; @IsNumber() @Min(0) @Max(1) y!:number; }
class StrokeDto {
 @Matches(/^#[0-9a-fA-F]{6}$/) color!:string;
 @IsNumber() @Min(.001) @Max(.03) width!:number;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1500) @ValidateNested({each:true}) @Type(()=>PointDto) points!:PointDto[];
}
export class SaveMarkupDto {
 @IsUUID() id!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>StrokeDto) strokes!:StrokeDto[];
}
export function markupSvg(strokes:StrokeDto[],width:number,height:number) {
 if(strokes.reduce((count,s)=>count+s.points.length,0)>4000)throw new BadRequestException('This drawing has too many points. Save a simpler mark-up.');
 const paths=strokes.map(s=>s.points.length===1?`<circle cx="${s.points[0].x*width}" cy="${s.points[0].y*height}" r="${s.width*width/2}" fill="${s.color}"/>`:`<polyline points="${s.points.map(p=>`${p.x*width},${p.y*height}`).join(' ')}" stroke="${s.color}" stroke-width="${s.width*width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
 return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${paths}</svg>`);
}
@Injectable()
export class AssetMarkupService {
 constructor(private readonly brief:BriefService,private readonly access:WorkspaceAccessService,private readonly storage:BrandAssetStorageService,private readonly events:CrmEventsService){}
 read(actor:RequestActor,w:string,c:string,id:string){return this.access.withPermission(actor,w,'pre_projects.view',async client=>{await this.brief.case(client,w,c);const asset=await client.query('SELECT id FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=$3',[w,c,id]);if(!asset.rowCount)throw new BadRequestException('Photo not found in this pre-execution.');const result=await client.query('SELECT source_asset_id AS "sourceAssetId",strokes FROM pre_project_asset_markups WHERE workspace_id=$1 AND case_id=$2 AND asset_id=$3',[w,c,id]);return result.rows[0]??{sourceAssetId:id,strokes:[]};});}
 save(actor:RequestActor,w:string,c:string,sourceId:string,input:SaveMarkupDto){return this.brief.edit(actor,w,c,async(client,userId)=>{
  const digest=createHash('sha256').update(JSON.stringify({sourceId,strokes:input.strokes})).digest('hex');
  const existing=await client.query('SELECT a.id,a.original_name AS name,a.mime_type AS "mimeType",a.byte_size AS "byteSize",a.preview_key IS NOT NULL AS "hasPreview",m.input_hash FROM pre_project_brief_assets a LEFT JOIN pre_project_asset_markups m ON m.asset_id=a.id WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.id=$3',[w,c,input.id]);
  if(existing.rowCount){if(existing.rows[0].input_hash!==digest)throw new ConflictException('This drawing ID is already in use. Reopen the photo.');const {input_hash,...asset}=existing.rows[0];return asset;}
  const source=await client.query('SELECT original_name,preview_key FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=$3',[w,c,sourceId]);
  if(!source.rowCount||!source.rows[0].preview_key)throw new BadRequestException('Choose an image from this pre-execution to draw on.');
  const image=await this.storage.read(source.rows[0].preview_key);const meta=await sharp(image.body).metadata();
  if(!meta.width||!meta.height)throw new BadRequestException('This photo cannot be opened.');
  const marked=await sharp(image.body).composite([{input:markupSvg(input.strokes,meta.width,meta.height)}]).png().toBuffer();
  const preview=await sharp(marked).webp({quality:85}).toBuffer();const key=`pre-projects/${w}/${c}/${input.id}`;const name=`Marked · ${source.rows[0].original_name.replace(/\.[^.]+$/,'')}`.slice(0,230)+'.png';
  await this.storage.put(`${key}/original`,marked,'image/png');await this.storage.put(`${key}/preview.webp`,preview,'image/webp');
  const result=await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by) VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8,$9) RETURNING id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",true AS "hasPreview"`,[input.id,w,c,name,marked.length,`${key}/original`,`${key}/preview.webp`,createHash('sha256').update(marked).digest('hex'),userId]);
  await client.query('INSERT INTO pre_project_asset_markups(workspace_id,case_id,asset_id,source_asset_id,strokes,input_hash) VALUES($1,$2,$3,$4,$5,$6)',[w,c,input.id,sourceId,JSON.stringify(input.strokes),digest]);
  await this.events.record(client,{workspaceId:w,actorUserId:userId,source:'user',action:'pre_project.asset_marked.v1',entityType:'pre_project_brief',entityId:input.id,after:{caseId:c,sourceAssetId:sourceId}});
  return result.rows[0];
 });}
}
@Controller('workspaces/:workspaceId/pre-projects/:caseId/assets/:id/markup')
export class AssetMarkupController {
 constructor(private readonly service:AssetMarkupService){}
 @Get() read(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe)c:string,@Param('id',ParseUUIDPipe)id:string){return this.service.read(a,w,c,id);}
 @Post() save(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe)w:string,@Param('caseId',ParseUUIDPipe)c:string,@Param('id',ParseUUIDPipe)id:string,@Body()input:SaveMarkupDto){return this.service.save(a,w,c,id,input);}
}
