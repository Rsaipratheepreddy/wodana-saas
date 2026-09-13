import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {RequestActor} from '../auth/actor';
import {WorkspaceAccessService} from '../workspaces/workspace-access.service';
import {CrmEventsService} from '../crm/shared/crm-events.service';
import {BriefService} from './brief.service';
import {ItemDimensionDto,SaveItemSpecificationDto} from './item-specification.dto';
type StoredDimension=ItemDimensionDto & {siteSurvey?:{id:string};verification?:string};
export function preserveSurveyDimensions(incoming:ItemDimensionDto[],previous:StoredDimension[]) {
 const keys=['name','unit','basis','approximate','measured','source','evidence'] as const;
 for(const old of previous.filter(d=>d.siteSurvey)) {
  const next=incoming.find(d=>d.id===old.id);
  if(!next||keys.some(key=>(old[key]??null)!==(next[key]??null)))throw new BadRequestException('Edit site survey dimensions in Site. Their evidence and verification history must stay together.');
 }
 return incoming.map(d=>previous.find(old=>old.id===d.id&&old.siteSurvey)??d);
}
export function normalizeItemDimension(value:number|null|undefined,unit:string) {if(value==null)return null;const factor:Record<string,number>={mm:.001,cm:.01,m:1,in:.0254,ft:.3048};if(!factor[unit])throw new BadRequestException('Choose a supported length unit.');return Number((value*factor[unit]).toPrecision(12));}
export function validateSelectionChange(material:SaveItemSpecificationDto['materials'][number],old?:SaveItemSpecificationDto['materials'][number]) {
 const keys=['application','materialId','brandId','finishId','productName','productCode','finishCode','stockSize'] as const;
 if(material.status==='selected'&&!material.materialId&&!material.productName.trim())throw new BadRequestException('Choose or name the selected product.');
 if(old?.status==='selected'&&material.status==='selected'&&keys.some(key=>material[key]!==old[key])&&material.evidence===old.evidence&&material.selectedAt===old.selectedAt&&JSON.stringify(material.assetIds)===JSON.stringify(old.assetIds))throw new BadRequestException('This selected product has changed. Keep it proposed or record fresh client confirmation.');
}
@Injectable()
export class ItemSpecificationService {
 constructor(private readonly access:WorkspaceAccessService,private readonly brief:BriefService,private readonly events:CrmEventsService){}
 history(actor:RequestActor,workspaceId:string,caseId:string,entryId:string) {
  return this.access.withPermission(actor,workspaceId,'pre_projects.view',async client=>{
   await this.brief.case(client,workspaceId,caseId);
   const entry=await client.query(`SELECT id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,entryId]);if(!entry.rowCount)throw new NotFoundException('Scope item not found.');
   return {items:(await client.query(`SELECT s.content,s.version,s.created_at AS "createdAt",u.display_name AS "recordedBy" FROM pre_project_item_specifications s JOIN users u ON u.id=s.created_by WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 ORDER BY version DESC`,[workspaceId,caseId,entryId])).rows.map(row=>({...row.content,version:row.version,createdAt:row.createdAt,recordedBy:row.recordedBy}))};
  });
 }
 save(actor:RequestActor,workspaceId:string,caseId:string,entryId:string,input:SaveItemSpecificationDto) {
  return this.brief.edit(actor,workspaceId,caseId,async(client,userId)=>{
   const entry=await client.query(`SELECT e.id,e.version,e.kind,e.title,e.note,e.quantity::text,e.unit,e.room_id AS "roomId",r.name AS "roomName",e.scope_status AS "scopeStatus",e.archived_at FROM pre_project_brief_entries e LEFT JOIN pre_project_rooms r ON r.workspace_id=e.workspace_id AND r.case_id=e.case_id AND r.id=e.room_id WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.id=$3`,[workspaceId,caseId,entryId]);
   if(!entry.rowCount)throw new NotFoundException('Scope item not found.');if(entry.rows[0].kind!=='requirement'||entry.rows[0].archived_at)throw new ConflictException('Choose an active scope item.');
   const previous=await client.query(`SELECT content,version FROM pre_project_item_specifications WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 ORDER BY version DESC LIMIT 1`,[workspaceId,caseId,entryId]);
   this.brief.version(previous.rows[0]?.version??0,input.version);
   const version=input.version+1;const catalogIds=new Set<string>();const materials=[];
   for(const material of input.materials) {
    if(material.status==='selected'&&(!material.selectedBy.trim()||!material.selectedAt||(!material.evidence.trim()&&!material.assetIds.length)))throw new BadRequestException(`Record the client, date and confirmation evidence for ${material.application}.`);
    if(material.status==='not_applicable'&&!material.evidence.trim())throw new BadRequestException(`Explain why a selection is not applicable for ${material.application}.`);
    const old=previous.rows[0]?.content?.materials?.find((r:{id:string})=>r.id===material.id);
    validateSelectionChange(material,old);
    const catalog:Record<string,unknown>={};
    for(const role of ['material','brand','finish'] as const) {
     const id=material[`${role}Id`];if(!id)continue;catalogIds.add(id);
     catalog[role]=old?.[`${role}Id`]===id?old.catalog?.[role]:undefined;
     if(!catalog[role])catalog[role]=await this.brief.catalogRecord(client,workspaceId,id,role);
    }
    const files=await client.query(`SELECT id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",preview_key IS NOT NULL AS "hasPreview" FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=ANY($3::uuid[])`,[workspaceId,caseId,material.assetIds]);if(files.rowCount!==material.assetIds.length)throw new BadRequestException('Selection evidence must belong to this pre-execution.');
    if(material.materialId&&material.brandId){const brands=await client.query(`SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='brand'`,[workspaceId,material.materialId]);if(brands.rowCount&&!brands.rows.some(r=>r.target_id===material.brandId))throw new BadRequestException(`The brand for ${material.application} must match the chosen product.`);}
    materials.push({...material,catalog,assets:files.rows,recordingSource:'staff_on_behalf'});
   }
   const dimensions=preserveSurveyDimensions(input.dimensions,previous.rows[0]?.content?.dimensions??[]).map(d=>{
    if('siteSurvey' in d&&d.siteSurvey)return d;
    if(d.approximate==null&&d.measured==null)throw new BadRequestException(`Enter an approximate or measured value for ${d.name}.`);
    if(d.measured!=null&&!d.evidence.trim())throw new BadRequestException(`Add a measurement source for ${d.name}.`);
    return {...d,approximateMetres:normalizeItemDimension(d.approximate,d.unit),measuredMetres:normalizeItemDimension(d.measured,d.unit),verification:'unverified'};
   });
   const designRefs=[];
   for(const reference of input.designRefs) {
    const result=await client.query(`SELECT v.id,v.number,v.status,v.design_id AS "designId",d.title,d.document_type AS "documentType",a.original_name AS "fileName",v.asset_id AS "assetId" FROM pre_project_design_versions v JOIN pre_project_designs d ON d.workspace_id=v.workspace_id AND d.case_id=v.case_id AND d.id=v.design_id JOIN pre_project_brief_assets a ON a.id=v.asset_id AND a.workspace_id=v.workspace_id AND a.case_id=v.case_id WHERE v.workspace_id=$1 AND v.case_id=$2 AND v.id=$3`,[workspaceId,caseId,reference.versionId]);
    if(!result.rowCount)throw new BadRequestException('Choose a design revision from this pre-execution.');designRefs.push({...reference,snapshot:result.rows[0]});
   }
   const links=await client.query(`SELECT role,record_id AS "recordId",snapshot FROM pre_project_scope_links WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3`,[workspaceId,caseId,entryId]);
   const {archived_at:_,...requirement}=entry.rows[0];
   const content={requirement:{...requirement,catalogLinks:links.rows},refinedRequirement:input.refinedRequirement,construction:input.construction,inclusions:input.inclusions,exclusions:input.exclusions,assumptions:input.assumptions,materials,dimensions,designRefs};
   const saved=await client.query(`INSERT INTO pre_project_item_specifications(workspace_id,case_id,entry_id,version,content,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at AS "createdAt"`,[workspaceId,caseId,entryId,version,content,userId]);
   for(const recordId of catalogIds)await client.query(`INSERT INTO pre_project_specification_catalog_refs(workspace_id,case_id,entry_id,version,record_id) VALUES($1,$2,$3,$4,$5)`,[workspaceId,caseId,entryId,version,recordId]);
   for(const ref of designRefs)await client.query(`INSERT INTO pre_project_item_design_refs(workspace_id,case_id,entry_id,version,design_version_id,usage,sheet) VALUES($1,$2,$3,$4,$5,$6,$7)`,[workspaceId,caseId,entryId,version,ref.versionId,ref.usage,ref.sheet]);
   await this.events.record(client,{workspaceId,actorUserId:userId,source:'user',action:'pre_project.item_specification_saved.v1',entityType:'pre_project_item_specification',entityId:entryId,after:{caseId,version,content}});
   return {...content,version,createdAt:saved.rows[0].createdAt};
  });
 }
}
