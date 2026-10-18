import type {ProjectData,ProjectDocument,ProjectRfa} from './execution.types';
import {activeReleasedScopeLines} from './project-scope-lines';
export const rfaLabels:Record<ProjectRfa['status'],string>={draft:'Draft',submitted:'Submitted',in_review:'In review',approved:'Approved',returned:'Returned',rejected:'Rejected',withdrawn:'Withdrawn'};
export function currentRfas(data:ProjectData) {
  const revised=new Set((data.rfas??[]).map(request=>request.revisionOf).filter(Boolean));
  return (data.rfas??[]).filter(request=>!revised.has(request.id));
}
export function rfaAffectedScope(data:ProjectData,request:ProjectRfa):string[] {
  const scope=new Set<string>(data.documents.find(doc=>doc.id===request.documentId)?.scopeLineIds??[]);
  const seen=new Set<string>();
  let current:ProjectRfa|undefined=request;
  while(current&&!seen.has(current.id)){
    seen.add(current.id);
    for(const id of current.snapshot?.document.scopeLineIds??[])scope.add(id);
    const previous:string|undefined=current.revisionOf;
    current=previous?data.rfas?.find(candidate=>candidate.id===previous):undefined;
  }
  return [...scope];
}
export function rfaReadiness(data:ProjectData,scopeIds:string[]) {
  const pending=currentRfas(data).find(request=>!['approved','withdrawn'].includes(request.status)&&(!!request.submittedAt||!!request.revisionOf)&&
    rfaAffectedScope(data,request).some(id=>scopeIds.includes(id)));
  return pending ? `Resolve the ${rfaLabels[pending.status].toLowerCase()} RFA for ${pending.snapshot?.document.title??data.documents.find(doc=>doc.id===pending.documentId)?.title??'this scope'} before starting work.` : undefined;
}
export function rfaSource(data:ProjectData,document:ProjectDocument) {
  const scope=activeReleasedScopeLines(data).filter(line=>document.scopeLineIds?.includes(line.id));
  const files=(data.files??[]).filter(file=>file.recordId===document.id||file.id===document.sourceDesignAssetId).map(({id,name,sha256,bytes})=>({id,name,sha256,bytes}));
  return {document:structuredClone(document),scope:structuredClone(scope),files};
}
export function rfaSourceSignature(snapshot:NonNullable<ProjectRfa['snapshot']>) {
  const {id,title,kind,revision,url,note,replaces,sourceDesignVersionId,sourceDesignAssetId,scopeLineIds}=snapshot.document;
  return JSON.stringify({id,title,kind,revision,url,note,replaces,sourceDesignVersionId,sourceDesignAssetId,scopeLineIds:[...(scopeLineIds??[])].sort(),scope:[...snapshot.scope].sort((a,b)=>a.id.localeCompare(b.id)),files:[...(snapshot.files??[])].sort((a,b)=>a.id.localeCompare(b.id))});
}
/** One canonical document decision, used by both legacy and RFA-controlled approvals. */
export function approveProjectDocument(data:ProjectData,doc:ProjectDocument,approverName:string) {
  if(doc.replaces){
    const old=data.documents.find(item=>item.id===doc.replaces);
    if(old){old.status='superseded';old.published=false;
      for(const task of data.tasks.filter(task=>task.drawingId===old.id&&!['completed','cancelled'].includes(task.status))){task.status='blocked';task.blocker='Drawing revised. Review affected work and link the approved revision.';}
    }
  }
  doc.approvedBy=approverName;doc.status='approved';
}
