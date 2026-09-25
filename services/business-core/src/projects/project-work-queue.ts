import type {HrmsContext} from '../hrms/hrms-access.service';
import {approvalQueueQuery} from './project-approval-queue';
import {BadRequestException} from '@nestjs/common';

export type WorkQueueKind='task'|'report'|'order'|'dispatch'|'snag'|'handover';
export type WorkQueueRow={id:string;recordId:string;projectId:string;projectName:string;clientName?:string;kind:WorkQueueKind;title:string;status:string;ownerId:string;ownerName:string;dueDate:string;href:string;location?:string;area?:string;priority?:string;resourceId?:string;resourceName?:string;packageId?:string;predecessorCount?:number};
export type WorkQueuePage={canManage?:boolean;rows:WorkQueueRow[];nextCursor:string|null;memberId:string;projects?:{id:string;name:string}[];members?:{id:string;name:string}[];resources?:{id:string;name:string}[]};
export type WorkQueueSource=Omit<WorkQueueRow,'id'|'href'> & {sortDue:string;location:string};
export const workQueueLabels:Record<WorkQueueKind,string>={task:'Execution',report:'Daily progress',order:'Procurement',dispatch:'Delivery',snag:'Snag / warranty',handover:'Handover'};
export function workQueuePage(records:WorkQueueSource[],memberId:string):WorkQueuePage {
 const visible=records.slice(0,100),last=visible.at(-1);
 return {memberId,nextCursor:records.length>100&&last?Buffer.from(JSON.stringify([last.sortDue,last.projectId,`${last.kind}:${last.recordId}`])).toString('base64url'):null,
 rows:visible.map(row=>{
  const section=row.kind==='task'?(row.location==='factory'?'production':row.location==='site'?'site-work':'plan-teams'):{report:'daily-progress',order:'procurement',dispatch:'production',snag:'snagging',handover:'handover'}[row.kind];
  return {id:`${row.projectId}:${row.kind}:${row.recordId}`,recordId:row.recordId,projectId:row.projectId,projectName:row.projectName,clientName:row.clientName,kind:row.kind,title:row.title,status:row.status,ownerId:row.ownerId,ownerName:row.ownerName||'Unassigned',dueDate:row.dueDate,location:row.location,area:row.area,priority:row.priority,resourceId:row.resourceId,resourceName:row.resourceName,packageId:row.packageId,predecessorCount:row.predecessorCount,href:`/workspace/projects/${encodeURIComponent(row.projectId)}/${section}?${row.kind==='dispatch'?'view=dispatch&':''}record=${encodeURIComponent(row.recordId)}`};
 })};
}

export async function readWorkQueue(ctx:HrmsContext,input:Record<string,unknown>) {
 const query=approvalQueueQuery(input,100);
 const projectId=String(input.projectId??''),ownerId=String(input.ownerId??'');
 const kind=String(input.kind??''),location=String(input.location??''),priority=String(input.priority??''),resourceId=String(input.resourceId??''),area=String(input.area??'').trim();
 const from=String(input.from??''),to=String(input.to??'');
 const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 if((projectId&&!uuid.test(projectId))||(ownerId&&ownerId!=='unassigned'&&!uuid.test(ownerId)))throw new BadRequestException('Choose a valid project and assignee.');
 if((kind&&!['task','report','order','dispatch','snag','handover'].includes(kind))||(location&&!['factory','site','office'].includes(location))||(priority&&!['normal','high','urgent'].includes(priority))||(resourceId&&!uuid.test(resourceId))||area.length>160)throw new BadRequestException('Choose valid work filters.');
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>=to))throw new BadRequestException('Choose a valid work date range.');
 const result=await ctx.client.query<WorkQueueSource>(`
 WITH authorized AS (
   SELECT p.id,p.name,e.content,party.display_name AS client_name FROM delivery_projects p
   JOIN project_execution_view e ON e.workspace_id=p.workspace_id AND e.project_id=p.id
   LEFT JOIN pre_project_cases c ON c.workspace_id=p.workspace_id AND c.id=p.case_id
   LEFT JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id
   LEFT JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id
   WHERE p.workspace_id=$1 AND p.status<>'archived'
   AND ($10::text='' OR p.id::text=$10)
   AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.membership_id=$2 AND a.active))
 ), sources AS (
   SELECT p.id,p.name,p.client_name,source.* FROM authorized p CROSS JOIN LATERAL (
     SELECT 'task' AS kind,value AS record,value->>'title' AS title,value->>'ownerId' AS owner_id,value->>'end' AS due,
       false AS review,'' AS author_id FROM jsonb_array_elements(coalesce(p.content->'tasks','[]'))
     UNION ALL SELECT 'report',value,concat('Daily output · ',value->>'date'),CASE WHEN value->>'status'='submitted' THEN '' ELSE value->>'authorId' END,value->>'date',value->>'status'='submitted',value->>'authorId' FROM jsonb_array_elements(coalesce(p.content->'reports','[]'))
     UNION ALL SELECT 'order',value,concat(value->>'number',' · ',value->>'title'),coalesce(value->>'ownerId',value->>'submittedBy',value->'rfqSnapshot'->>'capturedBy',''),value->>'promisedDate',value->>'status'='submitted',coalesce(value->>'submittedBy',value->'rfqSnapshot'->>'capturedBy','') FROM jsonb_array_elements(coalesce(p.content->'orders','[]'))
     UNION ALL SELECT 'dispatch',value,value->>'title',CASE WHEN value->>'status'='dispatched' THEN (SELECT task->>'ownerId' FROM jsonb_array_elements(coalesce(p.content->'tasks','[]')) task WHERE task->>'id'=value->>'receivingTaskId' LIMIT 1) ELSE value->>'preparedBy' END,value->>'dueDate',value->>'status'='draft',value->>'preparedBy' FROM jsonb_array_elements(coalesce(p.content->'dispatches','[]'))
     UNION ALL SELECT 'snag',value,value->>'title',value->>'ownerId',value->>'dueDate',false,'' FROM jsonb_array_elements(coalesce(p.content->'snags','[]'))
     UNION ALL SELECT 'handover',value,concat('Handover · ',value->>'area'),coalesce(value->>'ownerId',''),coalesce(value->>'dueDate',''),false,'' FROM jsonb_array_elements(coalesce(p.content->'handovers','[]'))
   ) source
 ), visible AS (
   SELECT s.id AS "projectId",s.name AS "projectName",coalesce(s.client_name,'') AS "clientName",s.kind,s.record->>'id' AS "recordId",s.title,
     coalesce(s.record->>'status','planned') AS status,coalesce(s.record->>'location','') AS location,
     coalesce(s.record->>'area','') AS area,coalesce(s.record->>'priority','normal') AS priority,
     coalesce(s.record->>'resourceId','') AS "resourceId",coalesce(s.record->>'packageId','') AS "packageId",
     coalesce((SELECT name FROM project_resources WHERE workspace_id=$1 AND id::text=s.record->>'resourceId'),'') AS "resourceName",
     jsonb_array_length(coalesce(s.record->'predecessors','[]')) AS "predecessorCount",
     coalesce(s.owner_id,'') AS "ownerId",coalesce(u.display_name,'') AS "ownerName",coalesce(s.due,'') AS "dueDate",
     coalesce(nullif(s.due,''),'9999-12-31') AS "sortDue"
   FROM sources s
   LEFT JOIN workspace_memberships m ON m.workspace_id=$1 AND m.id::text=s.owner_id AND m.status='active'
   LEFT JOIN users u ON u.id=m.user_id
   WHERE ($4='all' OR (coalesce(s.record->>'status','planned') NOT IN ('completed','cancelled','closed','withdrawn') AND NOT (s.kind='report' AND s.record->>'status'='approved') AND NOT (s.kind='dispatch' AND s.record->>'status'='received') AND NOT (s.kind='handover' AND s.record->>'status'='accepted')))
   AND ($4<>'mine' OR s.owner_id=$2::text OR (s.kind='task' AND coalesce(s.record->'assigneeIds','[]') ? $2::text) OR (s.review AND $9 AND s.author_id<>$2::text))
   AND ($5='' OR strpos(lower(concat(s.name,' ',s.client_name,' ',s.title)),lower($5))>0)
   AND ($11::text='' OR ($11='unassigned' AND coalesce(s.owner_id,'')='') OR s.owner_id=$11 OR (s.kind='task' AND coalesce(s.record->'assigneeIds','[]') ? $11))
   AND ($12::text='' OR s.kind=$12)
   AND ($13::text='' OR s.record->>'location'=$13)
   AND ($14::text='' OR s.record->>'priority'=$14)
   AND ($15::text='' OR s.record->>'resourceId'=$15)
   AND ($16::text='' OR strpos(lower(coalesce(s.record->>'area','')),lower($16))>0)
   AND ($17::text='' OR coalesce(s.due,'') >= $17)
   AND ($18::text='' OR coalesce(s.due,'') < $18)
 ) SELECT * FROM visible WHERE ($6::text IS NULL OR ("sortDue","projectId"::text,kind || ':' || "recordId")>($6::text,$7::text,$8::text))
 ORDER BY "sortDue","projectId"::text,kind || ':' || "recordId" LIMIT 101`,
 [ctx.workspaceId,ctx.membershipId,ctx.permissions.has('projects.manage'),query.view,query.q,...(query.after??[null,null,null]),ctx.permissions.has('projects.review'),projectId,ownerId,kind,location,priority,resourceId,area,from,to]);
 const projects=(await ctx.client.query<{id:string;name:string}>(`SELECT p.id,p.name FROM delivery_projects p WHERE p.workspace_id=$1 AND p.status<>'archived' AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.membership_id=$2 AND a.active)) ORDER BY p.name,p.id`,[ctx.workspaceId,ctx.membershipId,ctx.permissions.has('projects.manage')])).rows;
 // Use only people appearing in authorized projects; filter options must not
 // disclose assignments or names from projects the viewer cannot access.
 const members=projects.length?(await ctx.client.query<{id:string;name:string}>(`
 SELECT DISTINCT m.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.workspace_id=$1 AND m.status='active' AND (m.id=$2 OR EXISTS(
 SELECT 1 FROM project_assignments a WHERE a.workspace_id=$1 AND a.project_id=ANY($3::uuid[]) AND a.membership_id=m.id AND a.active) OR EXISTS(
 SELECT 1 FROM project_execution_view e WHERE e.workspace_id=$1 AND e.project_id=ANY($3::uuid[]) AND (
 jsonb_path_query_array(e.content,'$.tasks[*].ownerId') ? m.id::text OR jsonb_path_query_array(e.content,'$.tasks[*].assigneeIds[*]') ? m.id::text OR
 jsonb_path_query_array(e.content,'$.reports[*].authorId') ? m.id::text OR jsonb_path_query_array(e.content,'$.snags[*].ownerId') ? m.id::text OR
 jsonb_path_query_array(e.content,'$.dispatches[*].preparedBy') ? m.id::text OR jsonb_path_query_array(e.content,'$.orders[*].rfqSnapshot.capturedBy') ? m.id::text))) ORDER BY name,m.id`,[ctx.workspaceId,ctx.membershipId,projects.map(project=>project.id)])).rows:[];
 const resources=projects.length?(await ctx.client.query<{id:string;name:string}>(`SELECT r.id,r.name FROM project_resources r WHERE r.workspace_id=$1 AND r.active AND EXISTS(SELECT 1 FROM project_execution_view e WHERE e.workspace_id=r.workspace_id AND e.project_id=ANY($2::uuid[]) AND jsonb_path_query_array(e.content,'$.tasks[*].resourceId') ? r.id::text) ORDER BY r.name,r.id`,[ctx.workspaceId,projects.map(project=>project.id)])).rows:[];
 return {...workQueuePage(result.rows,ctx.membershipId),canManage:ctx.permissions.has('projects.manage'),projects,members,resources};
}
