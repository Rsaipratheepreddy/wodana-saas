import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestActor } from '../auth/actor';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { CrmEventsService } from '../crm/shared/crm-events.service';
import { BriefService } from './brief.service';
import { ItemDimensionDto } from './item-specification.dto';
import { normalizeItemDimension } from './item-specification.service';
import { ReviewSiteMeasurementDto, SaveSiteMeasurementDto, SaveSiteObservationDto, SaveSiteVisitDto, SiteLocationDto } from './site.dto';
import { syncOneTreeFromCase } from '../jobs/one-tree.store';

type Dimension = ItemDimensionDto & { verification?:string; siteSurvey?:{id:string;version:number;status:string}; approximateMetres?:number|null; measuredMetres?:number|null };
type SiteContent = Record<string,unknown> & { id:string;version:number;kind:string;title:string;status:string;roomId?:string|null;entryId?:string|null;visitId?:string|null;dimensions?:Dimension[];assetIds:string[];assets?:unknown[];evidenceConsentConfirmed?:boolean;evidenceConsent?:{confirmedAt:string;confirmedBy:string} };
const select = `SELECT s.content,s.site_id AS "siteId",s.version,s.updated_at AS "updatedAt",u.display_name AS "recordedBy",r.name AS "roomName",e.title AS "entryTitle",e.archived_at AS "entryArchivedAt",v.title AS "visitTitle"
 FROM pre_project_site_records s JOIN users u ON u.id=s.updated_by
 LEFT JOIN pre_project_rooms r ON r.workspace_id=s.workspace_id AND r.case_id=s.case_id AND r.id=s.room_id
 LEFT JOIN pre_project_brief_entries e ON e.workspace_id=s.workspace_id AND e.case_id=s.case_id AND e.id=s.entry_id
 LEFT JOIN pre_project_site_records v ON v.workspace_id=s.workspace_id AND v.case_id=s.case_id AND v.id=s.visit_id`;
const unpack=(row:Record<string,unknown>)=>{const {content,...rest}=row;return {...content as SiteContent,...rest};};

export function validateVisit(input:SaveSiteVisitDto) {
 try { new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format(); } catch { throw new BadRequestException('Choose a valid time zone.'); }
 if(!/(Z|[+-]\d\d:\d\d)$/.test(input.scheduledAt)||!Number.isFinite(Date.parse(input.scheduledAt)))throw new BadRequestException('The visit time must include its time zone offset.');
 if(input.status!=='planned'&&!input.outcome.trim())throw new BadRequestException('Add an outcome or cancellation reason.');
 if(input.status==='completed'&&Date.parse(input.scheduledAt)>Date.now())throw new BadRequestException('A future visit cannot be marked completed.');
}
export function normalizeSurveyDimensions(dimensions:ItemDimensionDto[]):Dimension[] {
 return dimensions.map(d=>{
  if(d.approximate==null&&d.measured==null)throw new BadRequestException(`Enter an approximate or measured value for ${d.name}.`);
  return {...d,approximate:d.approximate??null,measured:d.measured??null,approximateMetres:normalizeItemDimension(d.approximate,d.unit),measuredMetres:normalizeItemDimension(d.measured,d.unit)};
 });
}
export function assertSurveyReview(content:SiteContent,status:string) {
 if(status==='verified'&&(!content.dimensions?.length||content.dimensions.some(d=>d.measured==null)||!content.assetIds.length))throw new BadRequestException('Verification needs measured values for every dimension and at least one supporting photo or PDF.');
 if(content.status===status)throw new ConflictException(`This survey is already ${status==='verified'?'verified':'marked for recheck'}.`);
}
export function applyEvidenceConsent(content:SiteContent,previous:SiteContent|null,userId:string,now=()=>new Date()) {
 const {evidenceConsentConfirmed,...clean}=content;
 return {...clean,...(evidenceConsentConfirmed&&content.assetIds.length?{evidenceConsent:{confirmedAt:now().toISOString(),confirmedBy:userId}}:previous?.evidenceConsent?{evidenceConsent:previous.evidenceConsent}:{})};
}

@Injectable()
export class SiteService {
 constructor(private readonly access:WorkspaceAccessService,private readonly brief:BriefService,private readonly events:CrmEventsService){}

 list(actor:RequestActor,w:string,c:string) {
  return this.access.withPermission(actor,w,'pre_projects.view',async(client,user)=>{
   const context=await this.brief.case(client,w,c);
   const records=await client.query(`${select} WHERE s.workspace_id=$1 AND s.case_id=$2 ORDER BY s.updated_at DESC,s.id`,[w,c]);
   const members=await client.query(`SELECT u.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' AND u.status='active' ORDER BY u.display_name,u.id`,[w]);
   const workspace=await client.query(`SELECT default_timezone AS timezone,week_starts_on AS "weekStartsOn" FROM workspaces WHERE id=$1`,[w]);
   return {items:records.rows.map(unpack),members:members.rows,timezone:workspace.rows[0].timezone,weekStartsOn:workspace.rows[0].weekStartsOn,canVerify:context.status==='active'&&await this.access.hasPermission(client,w,user.userId,'pre_projects.verify_measurements')};
  });
 }
 history(actor:RequestActor,w:string,c:string,id:string) {
  return this.access.withPermission(actor,w,'pre_projects.view',async client=>{
   await this.brief.case(client,w,c);await this.current(client,w,c,id,true);
   const revisions=await client.query(`SELECT r.content,r.version,r.created_at AS "updatedAt",u.display_name AS "recordedBy" FROM pre_project_site_revisions r JOIN users u ON u.id=r.created_by WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.record_id=$3 ORDER BY r.version DESC`,[w,c,id]);
   return {items:revisions.rows.map(unpack)};
  });
 }
 saveVisit(actor:RequestActor,w:string,c:string,input:SaveSiteVisitDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   validateVisit(input);
   const previous=await this.previous(client,w,c,input,'visit');
   let assigneeName:string|null=null;
   if(input.assigneeId){const person=await client.query(`SELECT u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active'`,[w,input.assigneeId]);if(!person.rowCount)throw new BadRequestException('Choose an active workspace member for the visit.');assigneeName=person.rows[0].name;}
   return this.write(client,w,c,userId,{...input,kind:'visit',version:input.version+1,assigneeName,roomId:null,entryId:null,visitId:null,scheduledAt:new Date(input.scheduledAt).toISOString()},previous);
  });
 }
 saveObservation(actor:RequestActor,w:string,c:string,input:SaveSiteObservationDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   const previous=await this.previous(client,w,c,input,'observation');
   await this.location(client,w,c,input);
   if(input.status==='resolved'&&!input.resolution.trim())throw new BadRequestException('Explain how this observation was resolved.');
   return this.write(client,w,c,userId,{...input,kind:'observation',version:input.version+1,resolvedAt:input.status==='resolved'?(previous?.status==='resolved'?previous.resolvedAt:new Date().toISOString()):null,resolvedBy:input.status==='resolved'?(previous?.status==='resolved'?previous.resolvedBy:userId):null},previous);
  });
 }
 saveMeasurement(actor:RequestActor,w:string,c:string,input:SaveSiteMeasurementDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   const previous=await this.previous(client,w,c,input,'measurement');
   await this.location(client,w,c,input);
   if(!input.roomId&&!input.entryId)throw new BadRequestException('Choose a room or scope item to measure.');
   if(previous&&((previous.entryId??null)!==(input.entryId??null)||(previous.roomId??null)!==(input.roomId??null)))throw new BadRequestException('A saved measurement set keeps its original room and item. Create a separate set for another location.');
   if(input.entryId){const duplicate=await client.query(`SELECT id FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND kind='measurement' AND entry_id=$3 AND id<>$4`,[w,c,input.entryId,input.id]);if(duplicate.rowCount)throw new ConflictException('This item already has a measurement set. Open it to add a revision.');}
   const dimensions=normalizeSurveyDimensions(input.dimensions);
   const status=dimensions.every(d=>d.measured!=null)?'measured':'incomplete';
   const {specificationVersion,...fields}=input;
   const content:SiteContent={...fields,kind:'measurement',version:input.version+1,dimensions,status,reviewNote:'',verifiedBy:null,verifiedAt:null};
   const saved=await this.write(client,w,c,userId,content,previous);
   if(input.entryId)await this.syncSpecification(client,w,c,userId,content,specificationVersion,false);
   return saved;
  });
 }
 review(actor:RequestActor,w:string,c:string,id:string,input:ReviewSiteMeasurementDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   if(!await this.access.hasPermission(client,w,userId,'pre_projects.verify_measurements'))throw new ForbiddenException('You need measurement verification permission to record this review.');
   const previous=await this.current(client,w,c,id,true);
   if(previous!.kind!=='measurement')throw new BadRequestException('Choose a measurement set.');
   this.brief.version(previous!.version,input.version);assertSurveyReview(previous!,input.status);
   await this.location(client,w,c,previous as unknown as SiteLocationDto);
   const content={...previous!,version:input.version+1,status:input.status,reviewNote:input.note,verifiedBy:input.status==='verified'?userId:null,verifiedAt:input.status==='verified'?new Date().toISOString():null};
   const saved=await this.write(client,w,c,userId,content,previous);
   if(content.entryId)await this.syncSpecification(client,w,c,userId,content,null,true);
   return saved;
  });
 }
 private async current(client:PoolClient,w:string,c:string,id:string,required=false):Promise<SiteContent|null> {
  const found=await client.query(`SELECT content FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,id]);
  if(required&&!found.rowCount)throw new NotFoundException('Site record not found.');return found.rows[0]?.content??null;
 }
 private async previous(client:PoolClient,w:string,c:string,input:{id:string;version:number},kind:string) {
  const previous=await this.current(client,w,c,input.id,input.version>0);
  if(previous?.kind&&previous.kind!==kind)throw new BadRequestException('The site record type cannot change.');
  this.brief.version(previous?.version??0,input.version);return previous;
 }
 private async location(client:PoolClient,w:string,c:string,input:Pick<SiteLocationDto,'roomId'|'entryId'|'visitId'>) {
  if(input.roomId){const room=await client.query(`SELECT id FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,input.roomId]);if(!room.rowCount)throw new BadRequestException('Choose a room from this pre-execution.');}
  if(input.entryId){const entry=await client.query(`SELECT room_id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND kind='requirement' AND archived_at IS NULL`,[w,c,input.entryId]);if(!entry.rowCount)throw new BadRequestException('Choose an active scope item from this pre-execution.');if((entry.rows[0].room_id??null)!==(input.roomId??null))throw new BadRequestException('The room must match the chosen scope item.');}
  if(input.visitId){const visit=await this.current(client,w,c,input.visitId);if(visit?.kind!=='visit')throw new BadRequestException('Choose a visit from this pre-execution.');}
 }
 private async write(client:PoolClient,w:string,c:string,userId:string,content:SiteContent,previous:SiteContent|null) {
  content=applyEvidenceConsent(content,previous,userId);
  const tree=await syncOneTreeFromCase(client,w,c,userId);
  const assets=await client.query(`SELECT id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",preview_key IS NOT NULL AS "hasPreview" FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=ANY($3::uuid[]) ORDER BY created_at,id`,[w,c,content.assetIds]);
  if(assets.rowCount!==content.assetIds.length)throw new BadRequestException('Every attached file must belong to this pre-execution.');
  const names=(await client.query(`SELECT
   (SELECT name FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND id=$3) AS "roomName",
   (SELECT title FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$4) AS "entryTitle",
   (SELECT title FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND id=$5) AS "visitTitle"`,[w,c,content.roomId??null,content.entryId??null,content.visitId??null])).rows[0];
  content={...content,...names,siteId:tree.siteId,assets:assets.rows};
  const values=[w,c,content.id,tree.siteId,content.kind,content.roomId??null,content.entryId??null,content.visitId??null,content.title,content.status,content.version,content,userId];
  if(previous)await client.query(`UPDATE pre_project_site_records SET site_id=$4,kind=$5,room_id=$6,entry_id=$7,visit_id=$8,title=$9,status=$10,version=$11,content=$12,updated_by=$13,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,values);
  else await client.query(`INSERT INTO pre_project_site_records(workspace_id,case_id,id,site_id,kind,room_id,entry_id,visit_id,title,status,version,content,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,values);
  await client.query(`INSERT INTO pre_project_site_revisions(workspace_id,case_id,record_id,version,content,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[w,c,content.id,content.version,content,userId]);
  for(const assetId of content.assetIds)await client.query(`INSERT INTO pre_project_site_assets(workspace_id,case_id,record_id,version,asset_id) VALUES($1,$2,$3,$4,$5)`,[w,c,content.id,content.version,assetId]);
  await this.events.record(client,{workspaceId:w,actorUserId:userId,source:'user',action:`pre_project.site_${content.kind}_saved.v1`,entityType:'pre_project_site_record',entityId:content.id,before:previous??undefined,after:{caseId:c,...content}});
  return unpack((await client.query(`${select} WHERE s.workspace_id=$1 AND s.case_id=$2 AND s.id=$3`,[w,c,content.id])).rows[0]);
 }
 private async syncSpecification(client:PoolClient,w:string,c:string,userId:string,survey:SiteContent,expected:number|null,review:boolean) {
  const result=await client.query(`SELECT version,content FROM pre_project_item_specifications WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 ORDER BY version DESC LIMIT 1`,[w,c,survey.entryId]);
  const previous=result.rows[0];
  if(expected!==null)this.brief.version(previous?.version??0,expected);
  const mapped=survey.dimensions!.map(d=>({...d,verification:survey.status==='verified'?'verified':survey.status==='recheck'?'recheck':'unverified',siteSurvey:{id:survey.id,version:survey.version,status:survey.status,verifiedAt:survey.verifiedAt,verifiedBy:survey.verifiedBy}}));
  const existing:Dimension[]=previous?.content?.dimensions??[];
  // Review changes only the survey's dimensions; later material selections and other estimates survive.
  if(review&&survey.dimensions!.some(d=>!existing.some(old=>old.id===d.id&&old.siteSurvey?.id===survey.id&&old.measured===d.measured&&old.unit===d.unit&&old.basis===d.basis)))throw new ConflictException('Item dimensions changed after this survey. Save a new survey revision before reviewing.');
  const dimensions=review?existing.map(old=>mapped.find(d=>d.id===old.id)??old):mapped;
  const entry=(await client.query(`SELECT e.id,e.version,e.title,e.note,e.quantity::text,e.unit,e.room_id AS "roomId",r.name AS "roomName",e.scope_status AS "scopeStatus" FROM pre_project_brief_entries e LEFT JOIN pre_project_rooms r ON r.workspace_id=e.workspace_id AND r.case_id=e.case_id AND r.id=e.room_id WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.id=$3`,[w,c,survey.entryId])).rows[0];
  const links=(await client.query(`SELECT role,record_id AS "recordId",snapshot FROM pre_project_scope_links WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3`,[w,c,survey.entryId])).rows;
  const content={refinedRequirement:'',construction:'',inclusions:'',exclusions:'',assumptions:'',materials:[],designRefs:[],...previous?.content,requirement:{...entry,catalogLinks:links},dimensions};
  const version=(previous?.version??0)+1;
  await client.query(`INSERT INTO pre_project_item_specifications(workspace_id,case_id,entry_id,version,content,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[w,c,survey.entryId,version,content,userId]);
  if(previous){
   await client.query(`INSERT INTO pre_project_specification_catalog_refs(workspace_id,case_id,entry_id,version,record_id) SELECT workspace_id,case_id,entry_id,$4,record_id FROM pre_project_specification_catalog_refs WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 AND version=$5`,[w,c,survey.entryId,version,previous.version]);
   await client.query(`INSERT INTO pre_project_item_design_refs(workspace_id,case_id,entry_id,version,design_version_id,usage,sheet) SELECT workspace_id,case_id,entry_id,$4,design_version_id,usage,sheet FROM pre_project_item_design_refs WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 AND version=$5`,[w,c,survey.entryId,version,previous.version]);
  }
  await client.query(`INSERT INTO pre_project_site_specification_refs(workspace_id,case_id,record_id,version,entry_id,specification_version) VALUES($1,$2,$3,$4,$5,$6)`,[w,c,survey.id,survey.version,survey.entryId,version]);
 }
}
