import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { BriefService } from "./brief.service";
import { syncDesignStages } from "../design/design-stage-sync";
import { STAGE_LABELS, type JourneyStage } from "../design/design-journey.domain";
import { AddDesignVersionDto, DesignActivityDto, SaveDesignDto, SaveDesignFolderDto, UploadDesignFilesDto, CreateDesignThreadDto, ReplyDesignThreadDto, ResolveDesignThreadDto } from "./design.dto";

export function validateDesignTransition(status:string,action:string,note:string,decisionBy:string) {
 if(action==='comment') { if(!note.trim()) throw new BadRequestException('Enter a comment.'); return; }
 const allowed:Record<string,string[]>={draft:['internal_review'],internal_review:['internal_approved','changes_requested'],internal_approved:['client_review'],client_review:['approved','changes_requested'],approved:[],changes_requested:[]};
 if(!allowed[status]?.includes(action)) throw new ConflictException('This review action is no longer available. Reopen the latest design.');
 if(action==='changes_requested'&&!note.trim()) throw new BadRequestException('Describe the changes needed.');
 if((action==='approved'||(status==='client_review'&&action==='changes_requested'))&&(!decisionBy.trim()||!note.trim())) throw new BadRequestException('Record the client name and how their decision was received.');
}
export function nextIncludedClientRounds(requested:number|null|undefined,previous:number|null|undefined) {
 return requested===undefined ? previous??null : requested;
}
export function clientReviewExpiry(requested:string|undefined,now=new Date()) {
 const expiresAt=requested?new Date(requested):new Date(now.getTime()+7*24*60*60*1000);
 if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=now.getTime())throw new BadRequestException('Choose a client decision deadline in the future.');
 if(expiresAt.getTime()>now.getTime()+90*24*60*60*1000)throw new BadRequestException('Choose a client decision deadline within 90 days.');
 return expiresAt.toISOString();
}
export function clientRoundOverrideRequired(used:number,included:number|null|undefined) {
 return included!==null&&included!==undefined&&used>=included;
}
const designSelect=`SELECT d.id,d.title,d.folder_id AS "folderId",d.document_type AS "documentType",d.stage,d.description,d.version,d.room_id AS "roomId",r.name AS "roomName",d.scope_entry_id AS "scopeEntryId",e.title AS "scopeTitle",e.archived_at IS NOT NULL AS "scopeArchived",d.archived_at AS "archivedAt",d.updated_at AS "updatedAt",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'note',v.note,'status',CASE WHEN v.status='client_review' AND v.client_review_expires_at<=now() THEN 'expired' ELSE v.status END,'includedClientRounds',v.included_client_rounds,'clientReviewExpiresAt',v.client_review_expires_at,'createdAt',v.created_at,'createdByName',u.display_name,'createdBy',v.created_by,'reviewerId',v.reviewer_id,'asset',jsonb_build_object('id',a.id,'name',a.original_name,'mimeType',a.mime_type,'byteSize',a.byte_size,'hasPreview',a.preview_key IS NOT NULL)) ORDER BY v.number DESC)
 FROM pre_project_design_versions v JOIN pre_project_brief_assets a ON a.workspace_id=v.workspace_id AND a.case_id=v.case_id AND a.id=v.asset_id JOIN users u ON u.id=v.created_by WHERE v.workspace_id=d.workspace_id AND v.design_id=d.id),'[]'::jsonb) AS versions,
 COALESCE((SELECT count(DISTINCT h.version_id)::int FROM pre_project_design_activity h WHERE h.workspace_id=d.workspace_id AND h.design_id=d.id AND h.action='client_review'),0) AS "clientRoundsUsed",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'versionId',h.version_id,'action',h.action,'note',h.note,'decisionBy',h.decision_by,'reviewerId',h.reviewer_id,'decisionSource',h.decision_source,'decisionAt',h.decision_at,'createdAt',h.created_at,'createdByName',COALESCE(u.display_name,'Client portal')) ORDER BY h.created_at,h.id) FROM pre_project_design_activity h LEFT JOIN users u ON u.id=h.created_by WHERE h.workspace_id=d.workspace_id AND h.design_id=d.id),'[]'::jsonb) AS activity,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'versionId',t.version_id,'title',t.title,'anchor',t.anchor,'mentions',t.mentions,'blocking',t.blocking,'status',t.status,'version',t.version,'createdBy',t.created_by,'createdByName',tu.display_name,'createdAt',t.created_at,'resolvedAt',t.resolved_at,'resolvedByName',ru.display_name,'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'createdBy',m.created_by,'createdByName',mu.display_name,'createdAt',m.created_at) ORDER BY m.created_at,m.id) FROM pre_project_design_messages m JOIN users mu ON mu.id=m.created_by WHERE m.workspace_id=t.workspace_id AND m.thread_id=t.id),'[]'::jsonb)) ORDER BY t.created_at,t.id) FROM pre_project_design_threads t JOIN users tu ON tu.id=t.created_by LEFT JOIN users ru ON ru.id=t.resolved_by WHERE t.workspace_id=d.workspace_id AND t.case_id=d.case_id AND t.design_id=d.id),'[]'::jsonb) AS threads
 FROM pre_project_designs d LEFT JOIN pre_project_rooms r ON r.workspace_id=d.workspace_id AND r.case_id=d.case_id AND r.id=d.room_id LEFT JOIN pre_project_brief_entries e ON e.workspace_id=d.workspace_id AND e.case_id=d.case_id AND e.id=d.scope_entry_id`;

@Injectable()
export class DesignService {
 constructor(private readonly access:WorkspaceAccessService,private readonly brief:BriefService,private readonly events:CrmEventsService){}
 list(actor:RequestActor,workspaceId:string,caseId:string) {
  return this.access.withPermission(actor,workspaceId,'pre_projects.view',async(client,user)=>{
   const context=await this.brief.case(client,workspaceId,caseId);
   const folders=await client.query(`SELECT f.id,f.name,f.description,f.room_id AS "roomId",r.name AS "roomName",f.scope_entry_id AS "scopeEntryId",e.title AS "scopeTitle",f.version,f.reviewer_id AS "reviewerId",f.approved_versions AS "approvedVersions",f.approved_at AS "approvedAt"
    FROM pre_project_design_folders f
    LEFT JOIN pre_project_rooms r ON r.workspace_id=f.workspace_id AND r.case_id=f.case_id AND r.id=f.room_id
    LEFT JOIN pre_project_brief_entries e ON e.workspace_id=f.workspace_id AND e.case_id=f.case_id AND e.id=f.scope_entry_id
    WHERE f.workspace_id=$1 AND f.case_id=$2 ORDER BY lower(f.name),f.id`,[workspaceId,caseId]);
   const reviewers=await client.query(`SELECT DISTINCT u.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id JOIN effective_member_roles mr ON mr.membership_id=m.id JOIN role_permissions rp ON rp.role_id=mr.role_id JOIN permissions p ON p.id=rp.permission_id WHERE m.workspace_id=$1 AND m.status='active' AND u.status='active' AND p.code='pre_projects.review_designs' ORDER BY name`,[workspaceId]);
   const portal=await this.portalReadiness(client,workspaceId,caseId);
   const members=await client.query(`SELECT u.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' AND u.status='active' ORDER BY u.display_name`,[workspaceId]);
   return {members:members.rows,folders:folders.rows,reviewers:reviewers.rows,portal,actorId:user.userId,canReview:context.status==='active'&&await this.access.hasPermission(client,workspaceId,user.userId,'pre_projects.review_designs'),canRecordClient:context.status==='active'&&await this.access.hasPermission(client,workspaceId,user.userId,'pre_projects.record_client_design_decisions'),items:(await client.query(`${designSelect} WHERE d.workspace_id=$1 AND d.case_id=$2 ORDER BY d.updated_at DESC,d.id`,[workspaceId,caseId])).rows};
  });
 }
 save(actor:RequestActor,workspaceId:string,caseId:string,input:SaveDesignDto) {
  return this.brief.edit(actor,workspaceId,caseId,async(client,userId)=>{
   const existing=await client.query(`SELECT * FROM pre_project_designs WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.id]);
   const current=existing.rows[0];
   if(input.version>0&&!current) throw new NotFoundException('Design not found.');
   this.brief.version(current?.version??0,input.version);
   if(input.folderId) await this.validateFolderContext(client,workspaceId,caseId,input.folderId,input.roomId??null,input.scopeEntryId??null);
   const latest=current?await client.query(`SELECT status,included_client_rounds FROM pre_project_design_versions WHERE workspace_id=$1 AND design_id=$2 ORDER BY number DESC LIMIT 1`,[workspaceId,input.id]):{rows:[]};
   const policyChanged=input.includedClientRounds!==undefined&&(latest.rows[0]?.included_client_rounds??null)!==input.includedClientRounds;
   if(current&&(current.room_id!==(input.roomId??null)||current.scope_entry_id!==(input.scopeEntryId??null)||current.document_type!==input.documentType||(input.stage!==undefined&&(current.stage??null)!==(input.stage??null))||policyChanged)&&latest.rows[0]&&latest.rows[0].status!=='draft')throw new ConflictException('This file has entered review. Upload a new draft revision before changing its stage, room, scope, document type or included-round policy.');
   if(input.stage!==undefined)await this.validStage(client,workspaceId,caseId,input.stage??null);
   if(input.roomId) await this.belongs(client,'pre_project_rooms',workspaceId,caseId,input.roomId,'room');
   if(input.scopeEntryId) {
    const entry=await client.query(`SELECT room_id,archived_at,kind FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.scopeEntryId]);
    if(!entry.rowCount||entry.rows[0].kind!=='requirement'||(entry.rows[0].archived_at&&input.scopeEntryId!==current?.scope_entry_id)) throw new BadRequestException('Choose an active scope item from this pre-execution.');
    if((entry.rows[0].room_id??null)!==(input.roomId??null)) throw new BadRequestException('The design room must match its scope item.');
   }
   if(current) await client.query(`UPDATE pre_project_designs SET stage=CASE WHEN $11::boolean THEN $12::varchar ELSE stage END,title=$4,document_type=$5,description=$6,room_id=$7,scope_entry_id=$8,folder_id=$10,archived_at=CASE WHEN $9 THEN COALESCE(archived_at,now()) ELSE NULL END,version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.id,input.title,input.documentType,input.description,input.roomId??null,input.scopeEntryId??null,input.archived??Boolean(current.archived_at),input.folderId===undefined?current.folder_id:input.folderId,input.stage!==undefined,input.stage??null]);
   else await client.query(`INSERT INTO pre_project_designs(workspace_id,case_id,id,title,document_type,description,room_id,scope_entry_id,created_by,folder_id,stage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[workspaceId,caseId,input.id,input.title,input.documentType,input.description,input.roomId??null,input.scopeEntryId??null,userId,input.folderId??null,input.stage??null]);
   // Current draft notes may be edited; earlier revisions and review evidence remain untouched.
   if(current)await client.query(`UPDATE pre_project_design_versions SET note=$3,included_client_rounds=CASE WHEN $4::boolean THEN $5::smallint ELSE included_client_rounds END WHERE workspace_id=$1 AND design_id=$2 AND status='draft' AND number=(SELECT max(number) FROM pre_project_design_versions WHERE workspace_id=$1 AND design_id=$2)`,[workspaceId,input.id,input.description,input.includedClientRounds!==undefined,input.includedClientRounds??null]);
   await this.event(client,workspaceId,caseId,userId,input.id,'design_saved',input);
   // Archiving or moving a deliverable can leave its stage fully approved.
   await syncDesignStages(client,workspaceId,caseId,userId);
   return this.read(client,workspaceId,caseId,input.id);
  });
 }
 addVersion(actor:RequestActor,workspaceId:string,caseId:string,id:string,input:AddDesignVersionDto) {
  return this.brief.edit(actor,workspaceId,caseId,async(client,userId)=>{
   const design=await this.read(client,workspaceId,caseId,id);
   const retry=design.versions.find((v:{id:string})=>v.id===input.id);
   if(retry) { if(retry.asset.id!==input.assetId||retry.note!==input.note||(input.includedClientRounds!==undefined&&(retry.includedClientRounds??null)!==input.includedClientRounds)) throw new ConflictException('This version ID is already in use.'); return design; }
   this.mutable(design,input.version);
   await this.belongs(client,'pre_project_brief_assets',workspaceId,caseId,input.assetId,'file');
   await client.query(`INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,note,created_by,included_client_rounds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.id,workspaceId,caseId,id,(design.versions[0]?.number??0)+1,input.assetId,input.note,userId,nextIncludedClientRounds(input.includedClientRounds,design.versions[0]?.includedClientRounds)]);
   await client.query(`UPDATE pre_project_designs SET description=$3 WHERE workspace_id=$1 AND id=$2`,[workspaceId,id,input.note]);
   await this.touch(client,workspaceId,caseId,id);
   await this.event(client,workspaceId,caseId,userId,id,'design_version_added',input);
   return this.read(client,workspaceId,caseId,id);
  });
 }
 activity(actor:RequestActor,workspaceId:string,caseId:string,id:string,input:DesignActivityDto) {
  return this.brief.edit(actor,workspaceId,caseId,async(client,userId)=>{
   const design=await this.read(client,workspaceId,caseId,id);
   const retry=design.activity.find((a:{id:string})=>a.id===input.id);
   if(retry) { const replayVersion=design.versions.find((version:{id:string})=>version.id===input.versionId);if(retry.versionId!==input.versionId||retry.action!==input.action||retry.note!==input.note||retry.decisionBy!==input.decisionBy||(retry.reviewerId??null)!==(input.reviewerId??null)||(retry.decisionSource??null)!==(input.decisionSource??null)||(retry.decisionAt?new Date(retry.decisionAt).toISOString():null)!==(input.decisionAt?new Date(input.decisionAt).toISOString():null)||(input.action==='client_review'&&input.reviewExpiresAt&&new Date(replayVersion?.clientReviewExpiresAt??0).toISOString()!==new Date(input.reviewExpiresAt).toISOString())) throw new ConflictException('This activity ID is already in use.'); return design; }
   this.mutable(design,input.version);
   const latest=design.versions[0];
   if(!latest||!design.versions.some((v:{id:string})=>v.id===input.versionId)||(input.action!=='comment'&&latest.id!==input.versionId)) throw new ConflictException('Review the latest version. Earlier versions stay in history.');
   validateDesignTransition(latest.status,input.action,input.note,input.decisionBy);
   const clientDecision=latest.status==='client_review'&&input.action!=='comment';
   if(!clientDecision&&(input.decisionBy||input.decisionSource||input.decisionAt))throw new BadRequestException('Client decision details belong only to a client approval or change request.');
   if(input.action!=='client_review'&&input.reviewExpiresAt)throw new BadRequestException('A client decision deadline belongs only to a client review request.');
   if(input.action!=='internal_review'&&input.reviewerId)throw new BadRequestException('Assign a reviewer when requesting internal review.');
   if(input.action==='internal_review') {
    if(input.contextConfirmed!==true)throw new BadRequestException('Confirm that the preview matches its folder, room, item and design type before review.');
    if(!input.reviewerId||!await this.access.hasPermission(client,workspaceId,input.reviewerId,'pre_projects.review_designs'))throw new BadRequestException('Choose an active internal reviewer with design review permission.');
    const active=await client.query(`SELECT id FROM users WHERE id=$1 AND status='active'`,[input.reviewerId]);if(!active.rowCount)throw new BadRequestException('Choose an active reviewer.');
   }
   if(latest.status==='internal_review'&&input.action!=='comment') {
    if(!await this.access.hasPermission(client,workspaceId,userId,'pre_projects.review_designs'))throw new ForbiddenException('Design review permission is required.');
    if(latest.reviewerId&&latest.reviewerId!==userId)throw new ForbiddenException('Only the assigned reviewer can record this internal decision.');
   }
   if(latest.status==='client_review'&&input.action!=='comment') {
    if(!await this.access.hasPermission(client,workspaceId,userId,'pre_projects.record_client_design_decisions'))throw new ForbiddenException('Permission to record client design decisions is required.');
    if(!input.decisionSource||!input.decisionAt||!Number.isFinite(Date.parse(input.decisionAt))||Date.parse(input.decisionAt)>Date.now()||Date.parse(input.decisionAt)<Date.parse(latest.createdAt))throw new BadRequestException('Record the decision source and a date between this revision upload and now.');
   }
   if(input.action==='client_review'){
    // Presented in a meeting or by email until the client portal ships; staff then record the client's decision.
    if(clientRoundOverrideRequired(design.clientRoundsUsed??0,latest.includedClientRounds)&&!input.note.trim())throw new BadRequestException('Included client review rounds are used. Add the approved exception reason before sending another round.');
   }
   const reviewExpiresAt=input.action==='client_review'?clientReviewExpiry(input.reviewExpiresAt):null;
   // Legacy thread messages remain visible as comments; comments do not block approval.
   if(input.action==='internal_review')await client.query(`UPDATE pre_project_design_versions SET reviewer_id=$4 WHERE workspace_id=$1 AND design_id=$2 AND id=$3`,[workspaceId,id,input.versionId,input.reviewerId]);
   if(input.action!=='comment') await client.query(`UPDATE pre_project_design_versions SET status=$4::varchar,client_review_expires_at=CASE WHEN $4::varchar='client_review' THEN $5::timestamptz ELSE client_review_expires_at END WHERE workspace_id=$1 AND design_id=$2 AND id=$3`,[workspaceId,id,input.versionId,input.action,reviewExpiresAt]);
   await client.query(`INSERT INTO pre_project_design_activity(id,workspace_id,case_id,design_id,version_id,action,note,decision_by,created_by,reviewer_id,decision_source,decision_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[input.id,workspaceId,caseId,id,input.versionId,input.action,input.note,input.decisionBy,userId,input.reviewerId??null,input.decisionSource??null,input.decisionAt??null]);
   await this.touch(client,workspaceId,caseId,id);
   await this.event(client,workspaceId,caseId,userId,id,'design_'+input.action,input);
   if(input.action==='approved')await syncDesignStages(client,workspaceId,caseId,userId);
   return this.read(client,workspaceId,caseId,id);
  });
 }
 saveFolder(actor:RequestActor,w:string,c:string,input:SaveDesignFolderDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   const found=await client.query(`SELECT version FROM pre_project_design_folders WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,input.id]);
   if(input.version&&!found.rowCount)throw new NotFoundException('Folder not found.');
   this.brief.version(found.rows[0]?.version??0,input.version);
   if(!input.roomId&&!input.scopeEntryId)throw new BadRequestException('Choose a room, an item, or both for this folder.');
   let roomName='';let itemTitle='';
   if(input.roomId){const room=await client.query(`SELECT name FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,input.roomId]);if(!room.rowCount)throw new BadRequestException('Choose a room from this pre-execution.');roomName=room.rows[0].name;}
   if(input.scopeEntryId){
    const entry=await client.query(`SELECT room_id,title FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND kind='requirement' AND archived_at IS NULL`,[w,c,input.scopeEntryId]);
    if(!entry.rowCount)throw new BadRequestException('Choose an active requirement item from this pre-execution.');
    if((entry.rows[0].room_id??null)!==(input.roomId??null))throw new BadRequestException('The folder room must match its requirement item.');
    itemTitle=entry.rows[0].title;
   }
   const names=input.scopeEntryId?[itemTitle,...(roomName?[`${roomName} + ${itemTitle}`]:[])]:[roomName];
   if(!names.some(name=>name.slice(0,160)===input.name))throw new BadRequestException('The folder name must match its room, item, or room + item.');
   // BriefService.edit locks the case row, so this context check also covers concurrent creates.
   const duplicate=await client.query(`SELECT id FROM pre_project_design_folders WHERE workspace_id=$1 AND case_id=$2 AND id<>$4 AND (lower(name)=lower($3) OR ($5::uuid IS NOT NULL AND scope_entry_id=$5::uuid) OR ($5::uuid IS NULL AND $6::uuid IS NOT NULL AND scope_entry_id IS NULL AND room_id=$6::uuid))`,[w,c,input.name,input.id,input.scopeEntryId??null,input.roomId??null]);
   if(duplicate.rowCount)throw new ConflictException('A folder for this room or item already exists. Open it from All folders.');
   if(found.rowCount&&(input.roomId||input.scopeEntryId)){
    const mismatch=await client.query(`SELECT id FROM pre_project_designs WHERE workspace_id=$1 AND case_id=$2 AND folder_id=$3 AND ($4::uuid IS NOT NULL AND room_id IS DISTINCT FROM $4::uuid OR $5::uuid IS NOT NULL AND scope_entry_id IS DISTINCT FROM $5::uuid) LIMIT 1`,[w,c,input.id,input.roomId??null,input.scopeEntryId??null]);
    if(mismatch.rowCount)throw new ConflictException('Move files that use another room or requirement item before changing this folder.');
   }
   if(found.rowCount)await client.query(`UPDATE pre_project_design_folders SET name=$4,description=$5,room_id=$6,scope_entry_id=$7,version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,input.id,input.name,input.description,input.roomId??null,input.scopeEntryId??null]);
   else await client.query(`INSERT INTO pre_project_design_folders(workspace_id,case_id,id,name,description,room_id,scope_entry_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[w,c,input.id,input.name,input.description,input.roomId??null,input.scopeEntryId??null,userId]);
   await this.event(client,w,c,userId,input.id,'design_folder_saved',input);
   return this.readFolder(client,w,c,input.id);
  });
 }
 uploadFiles(actor:RequestActor,w:string,c:string,input:UploadDesignFilesDto) {
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   if(input.folderId)await this.validateFolderContext(client,w,c,input.folderId,input.roomId??null,input.scopeEntryId??null);
   if(input.roomId)await this.belongs(client,'pre_project_rooms',w,c,input.roomId,'room');
   if(input.scopeEntryId){const entry=await client.query(`SELECT room_id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND kind='requirement' AND archived_at IS NULL`,[w,c,input.scopeEntryId]);if(!entry.rowCount||(entry.rows[0].room_id??null)!==(input.roomId??null))throw new BadRequestException('Choose an active scope item in this room.');}
   if(input.stage!==undefined)await this.validStage(client,w,c,input.stage??null);
   // Client rounds come from the design package frozen on the journey unless set per file.
   const packageRounds=(await client.query<{rounds:number}>(`SELECT included_revisions AS rounds FROM design_journeys WHERE workspace_id=$1 AND case_id=$2`,[w,c])).rows[0]?.rounds??null;
   const items=[];
   for(const file of input.files){
    const note=file.note??input.note;
    const found=await client.query(`SELECT id FROM pre_project_designs WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,file.id]);
    if(found.rowCount){const previous=await this.read(client,w,c,file.id);const first=previous.versions.find((v:{id:string;includedClientRounds?:number|null})=>v.id===file.versionId);if(!first||first.asset.id!==file.assetId||previous.title!==file.title||(previous.folderId??null)!==(input.folderId??null)||previous.documentType!==file.documentType||(previous.roomId??null)!==(input.roomId??null)||(previous.scopeEntryId??null)!==(input.scopeEntryId??null)||first.note!==note||(file.includedClientRounds!==undefined&&(first.includedClientRounds??null)!==file.includedClientRounds))throw new ConflictException('This upload has changed. Reload the folder before trying again.');items.push(previous);continue;}
    await this.belongs(client,'pre_project_brief_assets',w,c,file.assetId,'file');
    await client.query(`INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,description,room_id,scope_entry_id,folder_id,created_by,stage) VALUES($1,$2,$3,$4,$5,$10,$6,$7,$8,$9,$11)`,[file.id,w,c,file.title,file.documentType,input.roomId??null,input.scopeEntryId??null,input.folderId??null,userId,note,input.stage??null]);
    await client.query(`INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,note,created_by,included_client_rounds) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`,[file.versionId,w,c,file.id,file.assetId,note,userId,file.includedClientRounds===undefined?packageRounds:file.includedClientRounds]);
    await this.event(client,w,c,userId,file.id,'design_version_added',{...file,folderId:input.folderId??null});
    items.push(await this.read(client,w,c,file.id));
   }
   return {items};
  });
 }
 createThread(actor:RequestActor,w:string,c:string,id:string,input:CreateDesignThreadDto){
  return this.commentAccess(actor,w,c,id,async(client,userId)=>{
   const design=await this.read(client,w,c,id);if(design.archivedAt)throw new ConflictException('Restore the design before adding discussions.');
   const retry=design.threads.find((t:{id:string})=>t.id===input.id);
   if(retry){if(retry.versionId!==input.versionId||retry.title!==input.title||retry.blocking!==input.blocking||retry.messages[0]?.body!==input.body||JSON.stringify(retry.anchor??null)!==JSON.stringify(input.anchor??null)||JSON.stringify(retry.mentions??[])!==JSON.stringify(input.mentions??[]))throw new ConflictException('This discussion ID is already in use.');return design;}
   if(!design.versions.some((v:{id:string})=>v.id===input.versionId))throw new BadRequestException('Choose a file revision from this design.');
   if(input.blocking&&design.versions.find((v:{id:string})=>v.id===input.versionId)?.status==='approved')throw new ConflictException('This revision is already approved. Start a new draft revision for blocking changes.');
   if(input.mentions?.length){const members=await client.query(`SELECT DISTINCT user_id FROM workspace_memberships WHERE workspace_id=$1 AND status='active' AND user_id=ANY($2::uuid[])`,[w,input.mentions]);if(members.rows.length!==input.mentions.length)throw new BadRequestException('Choose active workspace members.');}
   await client.query(`INSERT INTO pre_project_design_threads(id,workspace_id,case_id,design_id,version_id,title,blocking,created_by,anchor,mentions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,[input.id,w,c,id,input.versionId,input.title,input.blocking,userId,input.anchor == null ? null : JSON.stringify(input.anchor),JSON.stringify(input.mentions??[])]);
   await client.query(`INSERT INTO pre_project_design_messages(id,workspace_id,case_id,design_id,thread_id,body,created_by) VALUES($1,$2,$3,$4,$1,$5,$6)`,[input.id,w,c,id,input.body,userId]);
   await this.touch(client,w,c,id);await this.event(client,w,c,userId,id,'design_thread_started',input);return this.read(client,w,c,id);
  });
 }
 replyThread(actor:RequestActor,w:string,c:string,id:string,threadId:string,input:ReplyDesignThreadDto){
  return this.commentAccess(actor,w,c,id,async(client,userId)=>{
   const design=await this.read(client,w,c,id);if(design.archivedAt)throw new ConflictException('Restore the design before replying.');
   const thread=design.threads.find((t:{id:string})=>t.id===threadId);if(!thread)throw new NotFoundException('Discussion not found.');
   const retry=thread.messages.find((m:{id:string})=>m.id===input.id);if(retry){if(retry.body!==input.body||retry.createdBy!==userId)throw new ConflictException('This reply ID is already in use.');return design;}
   if(thread.status==='resolved')throw new ConflictException('Reopen the discussion before replying.');
   await client.query(`INSERT INTO pre_project_design_messages(id,workspace_id,case_id,design_id,thread_id,body,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.id,w,c,id,threadId,input.body,userId]);
   await client.query(`UPDATE pre_project_design_threads SET version=version+1 WHERE workspace_id=$1 AND case_id=$2 AND design_id=$3 AND id=$4`,[w,c,id,threadId]);
   await this.touch(client,w,c,id);await this.event(client,w,c,userId,id,'design_thread_replied',{threadId,...input});return this.read(client,w,c,id);
  });
 }
 resolveThread(actor:RequestActor,w:string,c:string,id:string,threadId:string,input:ResolveDesignThreadDto){
  return this.brief.edit(actor,w,c,async(client,userId)=>{
   const design=await this.read(client,w,c,id);if(design.archivedAt)throw new ConflictException('Restore the design before changing discussions.');
   const thread=design.threads.find((t:{id:string})=>t.id===threadId);if(!thread)throw new NotFoundException('Discussion not found.');this.brief.version(thread.version,input.version);
   const revision=design.versions.find((v:{id:string})=>v.id===thread.versionId);
   if(thread.createdBy!==userId&&revision?.reviewerId!==userId)throw new ForbiddenException('The discussion author or assigned reviewer can resolve or reopen it.');
   if(input.status==='open'&&thread.blocking&&revision?.status==='approved')throw new ConflictException('Start a new draft revision for blocking changes to an approved file.');
   if(thread.status===input.status)throw new ConflictException('This discussion is already in that state.');
   await client.query(`UPDATE pre_project_design_threads SET status=$5::varchar,version=version+1,resolved_by=CASE WHEN $5::varchar='resolved' THEN $6::uuid ELSE NULL END,resolved_at=CASE WHEN $5::varchar='resolved' THEN now() ELSE NULL END WHERE workspace_id=$1 AND case_id=$2 AND design_id=$3 AND id=$4`,[w,c,id,threadId,input.status,userId]);
   await this.touch(client,w,c,id);await this.event(client,w,c,userId,id,'design_thread_'+input.status,{threadId,...input});return this.read(client,w,c,id);
  });
 }
 private async portalReadiness(client:PoolClient,w:string,c:string){
  const result=await client.query(`SELECT s.enabled,s.slug,EXISTS(SELECT 1 FROM client_portal_grants g WHERE g.workspace_id=$1 AND g.case_id=$2 AND g.active=true AND g.role='approver') AS "hasApprover" FROM client_portal_settings s WHERE s.workspace_id=$1`,[w,c]);
  return result.rows[0]??{enabled:false,slug:null,hasApprover:false};
 }
 private async folder(client:PoolClient,w:string,c:string,id:string){const found=await client.query(`SELECT id,room_id,scope_entry_id FROM pre_project_design_folders WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[w,c,id]);if(!found.rowCount)throw new BadRequestException('Choose a folder from this pre-execution.');return found.rows[0];}
 private async validateFolderContext(client:PoolClient,w:string,c:string,id:string,roomId:string|null,scopeEntryId:string|null){
  const folder=await this.folder(client,w,c,id);
  if(folder.room_id&&(folder.room_id!==roomId))throw new BadRequestException('Files in this folder must use the folder room.');
  if(folder.scope_entry_id&&(folder.scope_entry_id!==scopeEntryId))throw new BadRequestException('Files in this folder must use the folder requirement item.');
 }
 private async readFolder(client:PoolClient,w:string,c:string,id:string){
  const result=await client.query(`SELECT f.id,f.name,f.description,f.room_id AS "roomId",r.name AS "roomName",f.scope_entry_id AS "scopeEntryId",e.title AS "scopeTitle",f.version,f.reviewer_id AS "reviewerId",f.approved_versions AS "approvedVersions",f.approved_at AS "approvedAt"
   FROM pre_project_design_folders f
   LEFT JOIN pre_project_rooms r ON r.workspace_id=f.workspace_id AND r.case_id=f.case_id AND r.id=f.room_id
   LEFT JOIN pre_project_brief_entries e ON e.workspace_id=f.workspace_id AND e.case_id=f.case_id AND e.id=f.scope_entry_id
   WHERE f.workspace_id=$1 AND f.case_id=$2 AND f.id=$3`,[w,c,id]);
  if(!result.rowCount)throw new NotFoundException('Folder not found.');return result.rows[0];
 }
 /** A deliverable's stage must be one the case's design package includes (any, before the journey starts). */
 private async validStage(client:PoolClient,w:string,c:string,stage:string|null){
  if(stage===null)return;
  const stages=(await client.query<{stage:string}>(`SELECT stage FROM design_journey_stages WHERE workspace_id=$1 AND case_id=$2`,[w,c])).rows.map(row=>row.stage);
  if(stages.length&&!stages.includes(stage))throw new BadRequestException(`${STAGE_LABELS[stage as JourneyStage]??'This stage'} is not part of this design package.`);
 }
 private mutable(design:{archivedAt:string|null;version:number},version:number) { this.brief.version(design.version,version);if(design.archivedAt)throw new ConflictException('Restore this design before changing it.'); }
 private async belongs(client:PoolClient,table:'pre_project_rooms'|'pre_project_brief_assets',workspaceId:string,caseId:string,id:string,label:string) {
  const result=await client.query(`SELECT id FROM ${table} WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,id]);
  if(!result.rowCount)throw new BadRequestException(`Choose a ${label} from this pre-execution.`);
 }
 private commentAccess<T>(actor:RequestActor,w:string,c:string,id:string,work:(client:PoolClient,userId:string)=>Promise<T>){
  return this.access.withPermission(actor,w,'pre_projects.view',async(client,user)=>{
   await this.brief.case(client,w,c,true);
   const editable=await this.access.hasPermission(client,w,user.userId,'pre_projects.edit');
   if(!editable){const assigned=await client.query(`SELECT f.id FROM pre_project_design_folders f JOIN pre_project_designs d ON d.folder_id=f.id AND d.workspace_id=f.workspace_id AND d.case_id=f.case_id WHERE d.workspace_id=$1 AND d.case_id=$2 AND d.id=$3 AND f.reviewer_id=$4`,[w,c,id,user.userId]);if(!assigned.rowCount||!await this.access.hasPermission(client,w,user.userId,'pre_projects.review_designs'))throw new ForbiddenException('Only editors or the assigned reviewer can comment.');}
   return work(client,user.userId);
  });
 }
 private touch(client:PoolClient,workspaceId:string,caseId:string,id:string) {return client.query(`UPDATE pre_project_designs SET version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,id]);}
 private async read(client:PoolClient,workspaceId:string,caseId:string,id:string) {const result=await client.query(`${designSelect} WHERE d.workspace_id=$1 AND d.case_id=$2 AND d.id=$3`,[workspaceId,caseId,id]);if(!result.rowCount)throw new NotFoundException('Design not found.');return result.rows[0];}
 private event(client:PoolClient,workspaceId:string,caseId:string,actorUserId:string,entityId:string,action:string,data:unknown) {return this.events.record(client,{workspaceId,actorUserId,entityId,entityType:'pre_project_design',source:'user',action:`pre_project.${action}.v1`,after:{caseId,data}});}
}
