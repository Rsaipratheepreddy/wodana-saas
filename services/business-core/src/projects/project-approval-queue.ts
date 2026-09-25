import {BadRequestException} from '@nestjs/common';
import type {ProjectRfa,ProjectDocument} from './execution.types';
export type ApprovalQueueRow={kind?:"rfa"|"order_amendment";id:string;requestId:string;projectId:string;projectName:string;title:string;revision:string;status:ProjectRfa['status'];ownerId:string;ownerName:string;dueDate:string;href:string};
export type ApprovalQueuePage={rows:ApprovalQueueRow[];nextCursor:string|null;memberId:string;canReview:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function approvalQueueQuery(query:Record<string,unknown>,maxIdentityLength=80){
 const view=query.view??'mine',q=query.q??'';
 if(!['mine','open','all'].includes(String(view))||typeof q!=='string'||q.length>160)throw new BadRequestException('Choose a valid approval view and search.');
 let after:[string,string,string]|null=null;
 if(query.cursor){
  try{if(typeof query.cursor!=='string'||query.cursor.length>600)throw Error();const value:unknown=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
   if(!Array.isArray(value)||value.length!==3||typeof value[0]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value[0])||typeof value[1]!=='string'||!uuid.test(value[1])||typeof value[2]!=='string'||!value[2]||value[2].length>maxIdentityLength)throw Error();after=value as [string,string,string];
  }catch{throw new BadRequestException('Refresh the approval queue; its page cursor is invalid.');}
 }
 return {view:String(view),q:q.trim(),after};
}
export type ApprovalQueueSource={projectId:string;projectName:string;kind?:"rfa"|"order_amendment";orderId?:string;request:Pick<ProjectRfa,"id"|"status"|"createdBy"> & Partial<Omit<ProjectRfa,"id"|"status"|"createdBy">>;document:Pick<ProjectDocument,'title'|'revision'>|null;ownerName:string|null;sortDue:string};
export function approvalQueuePage(records:ApprovalQueueSource[],memberId:string,canReview:boolean):ApprovalQueuePage{
 const visible=records.slice(0,100),last=visible.at(-1);
 return {memberId,canReview,nextCursor:records.length>100&&last?Buffer.from(JSON.stringify([last.sortDue,last.projectId,last.request.id])).toString('base64url'):null,rows:visible.map(({projectId,projectName,request,document,ownerName,kind,orderId})=>({kind:kind??"rfa",id:`${projectId}:${request.id}`,requestId:request.id,projectId,projectName,title:request.snapshot?.document.title??document?.title??'Document unavailable',revision:request.snapshot?.document.revision??document?.revision??'—',status:request.status,ownerId:['submitted','in_review'].includes(request.status)?(request.reviewerId??""):request.createdBy,ownerName:ownerName??'Member unavailable',dueDate:request.dueDate??"",href:kind==="order_amendment"?`/workspace/projects/${encodeURIComponent(projectId)}/procurement?record=${encodeURIComponent(orderId??"")}&amendment=${encodeURIComponent(request.id.replace(/^amendment:/,""))}`:`/workspace/projects/${encodeURIComponent(projectId)}/overview?view=approvals&record=${encodeURIComponent(request.id)}`}))};
}
