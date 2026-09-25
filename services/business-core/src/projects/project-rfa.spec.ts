import {describe,it,expect} from 'vitest';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
import type {ProjectDocument,ReleasedScopeLine} from './execution.types';
import {rfaReadiness} from './project-rfa';
import {projectExecutionPulse} from './project-execution-pulse';
const pm:ExecutionActor={id:'pm',name:'Planner',manage:true,review:true,report:false,buy:false,released:false,memberIds:['pm','reviewer','other'],resourceIds:[],now:'2026-09-22T00:00:00Z'};
const reviewer:ExecutionActor={...pm,id:'reviewer',name:'Reviewer',manage:false,review:true};
const line:ReleasedScopeLine={id:'scope',title:'Wardrobe',quantity:1,unit:'nos',room:'Bedroom',material:'Oak',sourceScopeVersion:1};
const doc:ProjectDocument={id:'doc',title:'Wardrobe drawing',kind:'drawing',revision:'R1',url:'https://example.com/drawing.pdf',note:'',status:'draft',replaces:'',published:false,scopeLineIds:['scope']};
function fixture(){const data=emptyProject();data.scope={quoteId:'q',quoteNumber:1,currency:'INR',value:100,lines:[structuredClone(line)]};data.documents=[structuredClone(doc)];return data;}
const save=(d:ReturnType<typeof fixture>,extra={})=>applyExecution(d,'rfa_save',{id:'rfa',version:0,documentId:'doc',reviewerId:'reviewer',dueDate:'2026-10-01',instructions:'Review dimensions',...extra},pm);
function submitted(){const d=fixture();save(d);applyExecution(d,'rfa_submit',{id:'rfa',version:1},pm);return d;}
function inReview(){const d=submitted();applyExecution(d,'rfa_review',{id:'rfa',version:2},reviewer);return d;}
describe('internal RFA contract',()=>{
 it('freezes source evidence and approves only through the assigned independent reviewer',()=>{
  const d=inReview();expect(d.rfas![0].snapshot?.document.status).toBe('draft');expect(rfaReadiness(d,['scope'])).toContain('in review');
  applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'approved'},reviewer);
  expect(d.documents[0]).toMatchObject({status:'approved',published:false,approvedBy:'Reviewer'});
  expect(d.rfas![0]).toMatchObject({status:'approved',version:4});expect(rfaReadiness(d,['scope'])).toBeUndefined();expect(d.phase).toBe('planning');
  expect(d.rfas![0].history.map(event=>event.action)).toEqual(['rfa_save','rfa_submit','rfa_review','rfa_approved']);
 });
 it.each([
  ['wrong reviewer',{...reviewer,id:'other'},'assigned'],
  ['missing review authority',{...reviewer,review:false},'assigned'],
  ['inactive reviewer',{...reviewer,memberIds:['pm']},'assigned'],
  ['submitter',{...pm},'assigned'],
 ])('rejects %s without mutation',(_name,actor,message)=>{
  const d=inReview(),before=structuredClone(d);expect(()=>applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'approved'},actor as ExecutionActor)).toThrow(String(message));expect(d).toEqual(before);
 });
 it('rejects self review at submission',()=>{const d=fixture();save(d,{reviewerId:'pm'});expect(()=>applyExecution(d,'rfa_submit',{id:'rfa',version:1},pm)).toThrow('independent');});
 it('rejects stale version and invalid transitions',()=>{const d=submitted();expect(()=>applyExecution(d,'rfa_review',{id:'rfa',version:1},reviewer)).toThrow('changed');expect(()=>applyExecution(d,'rfa_decide',{id:'rfa',version:2,decision:'approved'},reviewer)).toThrow('Start review');});
 it('does not allow legacy document actions to bypass the RFA',()=>{const d=submitted();expect(()=>applyExecution(d,'document_status',{id:'doc',status:'approved'},reviewer)).toThrow('linked RFA');expect(()=>applyExecution(d,'rfa_save',{id:'rfa',version:2,documentId:'doc'},pm)).toThrow('frozen');});
 it.each(['document','scope','deduction'])('blocks stale %s approval but allows return for correction',kind=>{
  const d=inReview();if(kind==='document')d.documents[0].revision='R2';else if(kind==='scope')d.scope!.lines[0].sourceScopeVersion=2;else d.scope!.lines=[];
  expect(()=>applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'approved'},reviewer)).toThrow('source changed');
  applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'returned',note:'Update source'},reviewer);expect(d.documents[0].status).toBe('draft');
 });
 it('preserves returned request history while revision draft keeps the scope blocked',()=>{
  const d=inReview();applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'returned',note:'Dimension missing'},reviewer);
  const original=structuredClone(d.rfas![0]);applyExecution(d,'rfa_revise',{id:'rfa',version:4,newId:'rfa-2',note:'Added dimension'},pm);
  expect(d.rfas![0]).toEqual(original);expect(d.rfas![1]).toMatchObject({revisionOf:'rfa',status:'draft',version:1});expect(rfaReadiness(d,['scope'])).toContain('draft');
  expect(()=>applyExecution(d,'rfa_withdraw',{id:'rfa',version:4,note:'Bypass'},pm)).toThrow('latest');
  applyExecution(d,'rfa_submit',{id:'rfa-2',version:1},pm);applyExecution(d,'rfa_review',{id:'rfa-2',version:2},reviewer);applyExecution(d,'rfa_decide',{id:'rfa-2',version:3,decision:'approved'},reviewer);expect(rfaReadiness(d,['scope'])).toBeUndefined();
 });
 it('requires reasons and preserves evidence on withdrawal',()=>{
  const d=submitted();expect(()=>applyExecution(d,'rfa_withdraw',{id:'rfa',version:2},pm)).toThrow('reason');
  applyExecution(d,'rfa_withdraw',{id:'rfa',version:2,note:'Duplicate requirement'},pm);expect(d.rfas![0].snapshot).toBeDefined();expect(d.documents[0].status).toBe('draft');expect(rfaReadiness(d,['scope'])).toBeUndefined();
 });
 it('enforces active source, valid due date and one open request per document',()=>{
  const d=fixture();expect(()=>save(d,{dueDate:'2026-02-31'})).toThrow('valid review due');save(d);expect(()=>save(d,{id:'second'})).toThrow('open RFA');d.scope!.lines=[];expect(()=>applyExecution(d,'rfa_submit',{id:'rfa',version:1},pm)).toThrow('active released');
 });
 it('projects pending review into the canonical next-action queue with its reviewer',()=>{
  const d=submitted();expect(projectExecutionPulse(d,'2026-10-02').nextActions).toContainEqual(expect.objectContaining({kind:'review_rfa',recordId:'rfa',ownerId:'reviewer',priority:'high'}));
 });
 it('requires a linked revision instead of creating an unrelated replacement request',()=>{
  const d=inReview();applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'rejected',note:'Wrong scope'},reviewer);
  expect(()=>save(d,{id:'new'})).toThrow('revision of the existing RFA');
 });
});
it('rejects assignment to an active member without review authority',()=>{
 const d=fixture();expect(()=>applyExecution(d,'rfa_save',{id:'rfa',version:0,documentId:'doc',reviewerId:'other',dueDate:'2026-10-01'},{...pm,reviewerIds:['reviewer']})).toThrow('active reviewer');
 save(d);expect(()=>applyExecution(d,'rfa_submit',{id:'rfa',version:1},{...pm,reviewerIds:[]})).toThrow('active reviewer');
});
it('keeps the original scope blocked when a revision draft changes its document links',()=>{
 const d=inReview();applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'returned',note:'Correct details'},reviewer);
 applyExecution(d,'rfa_revise',{id:'rfa',version:4,newId:'revision',note:'Updated drawing'},pm);
 d.scope!.lines.push({...line,id:'other'});d.documents[0].scopeLineIds=['other'];
 expect(rfaReadiness(d,['scope'])).toContain('draft');
 expect(()=>applyExecution(d,'rfa_submit',{id:'revision',version:1},pm)).toThrow('affected scope');
});
it('applies document supersession through RFA approval and blocks affected ongoing work',()=>{
 const d=inReview();d.documents.push({...doc,id:'previous',status:'approved',published:true});
 d.documents[0].replaces='previous';d.rfas![0].snapshot!.document.replaces='previous';
 d.tasks.push({id:'t',drawingId:'previous',status:'planned',approved:0,quantity:1,weight:1,predecessors:[]} as never);
 applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'approved'},reviewer);
 expect(d.documents[1]).toMatchObject({status:'superseded',published:false});expect(d.tasks[0].status).toBe('blocked');
});
it('blocks task start for scope with an unresolved RFA',()=>{
 const d=submitted();d.tasks.push({id:'t',status:'planned',scopeIds:['scope'],predecessors:[],ownerId:'pm',location:'office',readiness:{scope:true,access:true,materials:true}} as never);
 expect(()=>applyExecution(d,'task_status',{id:'t',status:'in_progress'},{...pm,released:true})).toThrow('RFA');
});
it('detects changed managed attachment evidence after submission',()=>{
 const d=inReview();d.files=[{id:'file',recordId:'doc',name:'drawing.pdf',mimeType:'application/pdf',bytes:500,sha256:'changed',by:'pm',at:pm.now}];
 expect(()=>applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'approved'},reviewer)).toThrow('source changed');
});
it('resubmits corrected document content while preserving the returned snapshot',()=>{
 const d=inReview();applyExecution(d,'rfa_decide',{id:'rfa',version:3,decision:'returned',note:'Update dimensions'},reviewer);
 applyExecution(d,'document',{document:{...d.documents[0],revision:'R2',note:'Corrected dimensions'}},pm);
 applyExecution(d,'rfa_revise',{id:'rfa',version:4,newId:'rfa-r2',note:'Dimensions corrected'},pm);
 applyExecution(d,'rfa_submit',{id:'rfa-r2',version:1},pm);applyExecution(d,'rfa_review',{id:'rfa-r2',version:2},reviewer);applyExecution(d,'rfa_decide',{id:'rfa-r2',version:3,decision:'approved'},reviewer);
 expect(d.rfas![0].snapshot?.document.revision).toBe('R1');expect(d.rfas![1].snapshot?.document.revision).toBe('R2');expect(d.documents[0].status).toBe('approved');
});
