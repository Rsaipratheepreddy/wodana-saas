import {BadRequestException,ConflictException,ForbiddenException} from '@nestjs/common';
import {activeReleasedScopeLines} from './project-scope-lines';
import type {ExecutionActor} from './execution.domain';
import type {ProjectData,ProjectRfa} from './execution.types';
import {approveProjectDocument,rfaSource,rfaSourceSignature,rfaAffectedScope} from './project-rfa';
export function applyRfa(data:ProjectData,action:string,input:Record<string,unknown>,actor:ExecutionActor) {
  const text=(value:unknown,max=3000)=>{if(typeof value!=='string'||value.length>max)throw new BadRequestException('Enter valid RFA fields.');return value.trim();};
  const id=text(input.id,80);if(!id)throw new BadRequestException('Use a stable RFA identifier.');
  const existing=data.rfas??[];
  const old=existing.find(request=>request.id===id);
  if(input.version!==(old?.version??0))throw new ConflictException('This RFA changed. Refresh and review before saving.');
  const manage=()=>{if(!actor.manage)throw new ForbiddenException('A project planner must make this change.');};
  const reason=()=>{const note=text(input.note??'');if(!note)throw new BadRequestException('Record a reason for this decision.');return note;};
  let request:ProjectRfa;
  let note='';
  if(action==='rfa_save'){
    manage();if(old&&old.status!=='draft')throw new ConflictException('Submitted RFA content is frozen. Create a revision.');
    const documentId=text(input.documentId,80),reviewerId=text(input.reviewerId??'',80),dueDate=text(input.dueDate??'',10),instructions=text(input.instructions??'');
    const doc=data.documents.find(doc=>doc.id===documentId);
    if(!doc||doc.status!=='draft')throw new BadRequestException('Choose a draft controlled document.');
    if(old?.revisionOf&&documentId!==old.documentId)throw new BadRequestException('Keep the original controlled document for this RFA revision.');
    if(reviewerId&&(!actor.memberIds.includes(reviewerId)||(actor.reviewerIds&&!actor.reviewerIds.includes(reviewerId))))throw new BadRequestException('Choose an active reviewer.');
    if(dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate))||new Date(dueDate).toISOString().slice(0,10)!==dueDate))throw new BadRequestException('Enter a valid review due date.');
    if(existing.some(item=>item.id!==id&&item.documentId===documentId&&['draft','submitted','in_review'].includes(item.status)))throw new ConflictException('This document already has an open RFA.');
    if(!old&&existing.some(item=>item.documentId===documentId))throw new ConflictException('Create a revision of the existing RFA for this document.');
    request={...(old??{id,createdAt:actor.now,createdBy:actor.id,history:[]}),version:(old?.version??0)+1,documentId,reviewerId,dueDate,instructions,status:'draft'};
  }else{
    if(!old)throw new BadRequestException('Choose an existing RFA.');
    if(existing.some(item=>item.revisionOf===old.id))throw new ConflictException('Use the latest RFA revision.');
    if(existing.some(item=>item.id!==old.id&&item.documentId===old.documentId&&['submitted','in_review'].includes(item.status)))throw new ConflictException('Another RFA controls the current document review.');
    request=structuredClone(old);request.version++;
    const doc=data.documents.find(doc=>doc.id===old.documentId);
    if(!doc)throw new ConflictException('The controlled document is unavailable.');
    if(action==='rfa_submit'){
      manage();if(old.status!=='draft'||doc.status!=='draft')throw new ConflictException('Submit a draft RFA and document.');
      if(!old.dueDate||!old.reviewerId||(!actor.memberIds.includes(old.reviewerId)||(actor.reviewerIds&&!actor.reviewerIds.includes(old.reviewerId))))throw new BadRequestException('Assign an active reviewer and review due date.');
      if(old.reviewerId===actor.id)throw new ForbiddenException('Choose an independent reviewer before submitting.');
      const snapshot=rfaSource(data,doc);
      if(!doc.scopeLineIds?.length||snapshot.scope.length!==new Set(doc.scopeLineIds).size)throw new ConflictException('Link this document to active released BOQ scope before submitting.');
      if(!doc.url&&!doc.note)throw new BadRequestException('Attach the document or a controlled reference.');
      const activeIds=new Set(activeReleasedScopeLines(data).map(line=>line.id));
      if(old.revisionOf&&rfaAffectedScope(data,old).some(id=>activeIds.has(id)&&!doc.scopeLineIds?.includes(id)))throw new ConflictException('Keep the affected scope in this revision or explicitly withdraw the request.');
      request.snapshot=snapshot;request.submittedBy=actor.id;request.submittedAt=actor.now;request.status='submitted';
    }else if(action==='rfa_review'||action==='rfa_decide'){
      if(!actor.review||actor.id!==old.reviewerId||!actor.memberIds.includes(actor.id))throw new ForbiddenException('Only the assigned active reviewer can decide this RFA.');
      if(actor.id===old.submittedBy)throw new ForbiddenException('The submitter cannot approve their own RFA.');
      if(action==='rfa_review'){
        if(old.status!=='submitted')throw new ConflictException('Start review on a submitted RFA.');request.status='in_review';
      }else{
        if(old.status!=='in_review')throw new ConflictException('Start review before recording a decision.');
        if(!['approved','returned','rejected'].includes(String(input.decision)))throw new BadRequestException('Choose an approval decision.');
        request.status=input.decision as 'approved'|'returned'|'rejected';
        note=request.status==='approved'?text(input.note??''):reason();
      }
      if(request.status==='approved'||action==='rfa_review'){
        const source=rfaSource(data,doc);
        if(doc.status!=='review'||!old.snapshot||rfaSourceSignature(source)!==rfaSourceSignature(old.snapshot))throw new ConflictException('The submitted source changed. Return this RFA for revision.');
        if(doc.replaces&&!data.documents.some(item=>item.id===doc.replaces))throw new ConflictException('The replaced document is unavailable.');
      }
    }else if(action==='rfa_withdraw'){
      manage();if(['approved','superseded'].includes(doc.status))throw new ConflictException('An approved document cannot be withdrawn through an older RFA.');if(!['draft','submitted','in_review','returned','rejected'].includes(old.status))throw new ConflictException('This RFA cannot be withdrawn.');note=reason();request.status='withdrawn';
    }else if(action==='rfa_revise'){
      manage();if(!['returned','rejected','withdrawn'].includes(old.status))throw new ConflictException('Revise a returned, rejected or withdrawn RFA.');note=reason();
      if(existing.some(item=>item.revisionOf===old.id)||existing.some(item=>item.id!==old.id&&item.documentId===old.documentId&&['draft','submitted','in_review'].includes(item.status)))throw new ConflictException('An RFA revision already exists.');
      const nextId=text(input.newId,80);if(!nextId||existing.some(item=>item.id===nextId))throw new ConflictException('Use a new RFA identifier.');
      if(doc.status!=='draft')throw new ConflictException('Revise the draft controlled document first.');
      request={id:nextId,version:1,status:'draft',documentId:old.documentId,reviewerId:old.reviewerId,dueDate:old.dueDate,instructions:old.instructions,createdAt:actor.now,createdBy:actor.id,revisionOf:old.id,history:[]};
    }else throw new BadRequestException('Unknown RFA action.');
  }
  request.history.push({action:action==='rfa_decide'?`rfa_${request.status}`:action,actorId:actor.id,at:actor.now,note});
  // Mutate only after every guard passes.
  const doc=data.documents.find(doc=>doc.id===request.documentId)!;
  if(action==='rfa_submit')doc.status='review';
  if(action==='rfa_decide'&&request.status==='approved')approveProjectDocument(data,doc,actor.name);
  if(action==='rfa_withdraw'||(action==='rfa_decide'&&['returned','rejected'].includes(request.status)))doc.status='draft';
  data.rfas=existing.filter(item=>item.id!==request.id).concat(request);
  return request.id;
}
