import {BadRequestException,ConflictException,ForbiddenException} from '@nestjs/common';
import type {PoolClient} from 'pg';

export async function portalReviewDesign(client:PoolClient,workspaceId:string,caseId:string,versionId:string) {
 if(!/^[0-9a-f-]{36}$/i.test(versionId))throw new BadRequestException('Choose a design file.');
 const result=await client.query(`SELECT d.id,v.status,v.number FROM pre_project_designs d JOIN pre_project_design_versions v ON v.workspace_id=d.workspace_id AND v.design_id=d.id JOIN pre_project_cases c ON c.workspace_id=d.workspace_id AND c.id=d.case_id WHERE d.workspace_id=$1 AND d.case_id=$2 AND v.id=$3 AND c.status='active' AND d.archived_at IS NULL AND v.number=(SELECT max(number) FROM pre_project_design_versions WHERE workspace_id=d.workspace_id AND design_id=d.id)`,[workspaceId,caseId,versionId]);
 if(!result.rowCount||result.rows[0].status!=='client_review')throw new ConflictException('This file is no longer awaiting your approval. Reload the portal.');
 return result.rows[0] as {id:string;status:string;number:number};
}

export async function decidePortalDesign(client:PoolClient,workspaceId:string,caseId:string,grant:{id:string;name:string;role:string},input:{versionId:string;decision:string;note:string;challengeId:string},verify:()=>Promise<string|null>) {
 if(grant.role!=='approver')throw new ForbiddenException('Only the designated client approver can decide.');
 if(!['accept','changes'].includes(input.decision))throw new BadRequestException('Choose approve or reject.');
 if(input.decision==='changes'&&!input.note.trim())throw new BadRequestException('Add remarks before rejecting this file.');
 if(input.note.length>5000||!/^[0-9a-f-]{36}$/i.test(input.challengeId))throw new BadRequestException('Invalid design approval.');
 const action=input.decision==='accept'?'approved':'changes_requested';
 const replay=await client.query(`SELECT action,note,version_id,client_grant_id FROM pre_project_design_activity WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.challengeId]);
 if(replay.rowCount){const row=replay.rows[0];if(row.action!==action||row.note!==input.note||row.version_id!==input.versionId||row.client_grant_id!==grant.id)throw new ConflictException('This approval has already been recorded differently.');return {ok:true,replayed:true};}
 const design=await portalReviewDesign(client,workspaceId,caseId,input.versionId);
 if(!await verify())return {invalidCode:true};
 await client.query(`UPDATE pre_project_design_versions SET status=$4 WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.versionId,action]);
 await client.query(`INSERT INTO pre_project_design_activity(id,workspace_id,case_id,design_id,version_id,action,note,decision_by,created_by,client_grant_id,decision_source,decision_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,'client_portal',now())`,[input.challengeId,workspaceId,caseId,design.id,input.versionId,action,input.note,grant.name,grant.id]);
 await client.query(`UPDATE pre_project_designs SET version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,design.id]);
 await client.query(`UPDATE pre_project_cases SET updated_at=now() WHERE workspace_id=$1 AND id=$2`,[workspaceId,caseId]);
 return {ok:true};
}
