import { describe, expect, it } from 'vitest';
import { applyExecution, emptyProject, type ExecutionActor } from './execution.domain';
import { installationMaterialCapacity } from './project-installation-materials';
import type { Task } from './execution.types';
const manager:ExecutionActor={id:'pm',name:'Planner',manage:true,review:true,report:true,buy:true,memberIds:['pm','qc'],resourceIds:[],released:true,now:'2026-09-22T10:00:00Z'};
function fixture(){
 const d=emptyProject();d.phase='active';
 const task:Task={id:'site',parentId:'',package:'Chairs',title:'Install chairs',description:'',area:'Room',location:'site',ownerId:'pm',assigneeIds:[],resourceId:'',start:'2026-09-22',end:'2026-09-23',baselineStart:'2026-09-22',baselineEnd:'2026-09-23',predecessors:[],quantity:10,unit:'chair',weight:1,approved:0,status:'in_progress',priority:'normal',inspectionRequired:false,scopeIds:[],drawingId:'',readiness:{scope:true,access:true,materials:true},blocker:''};
 d.tasks=[task];d.materials=[{id:'m',title:'Brackets',specification:'',catalogId:'',catalogVersion:0,unit:'piece',required:40,supply:'company',taskId:'site',needBy:'2026-09-22',movements:[]}];
 applyExecution(d,'material_output_basis',{id:'m',perUnit:4,note:'Four brackets per chair'},manager);
 d.orders=[{id:'po',number:'PO1',title:'Brackets',vendor:'Supplier',vendorContact:'',kind:'material',materialId:'m',taskId:'site',quantity:40,unit:'piece',unitCost:1,currency:'AED',promisedDate:'2026-09-22',status:'acknowledged',acknowledgement:'Yes',receipts:[]}];
 return d;
}
describe('material-backed installation',()=>{
 it('requires issued material before starting controlled site work',()=>{
  const d=fixture();d.tasks[0].status='planned';d.tasks[0].drawingId='drawing';
  d.documents=[{id:'drawing',title:'Approved plan',kind:'drawing',revision:'1',url:'',note:'',status:'approved',replaces:'',published:false}];
  expect(()=>applyExecution(d,'task_status',{id:'site',status:'in_progress'},manager)).toThrow('Issue accepted materials');
  d.materials[0].movements=[{id:'r',kind:'receive',quantity:4,at:'now',reference:'QC'},{id:'i',kind:'issue',quantity:4,taskId:'site',at:'now',reference:'Issued'}];
  applyExecution(d,'task_status',{id:'site',status:'in_progress'},manager);expect(d.tasks[0].status).toBe('in_progress');
 });
 it('connects partial receipt QC, task issue and approved site output without counting warehouse stock',()=>{
  const d=fixture();applyExecution(d,'receipt',{id:'po',received:20,accepted:0,rejected:0,pending:20,note:'DN1'},manager);
  expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(0);
  applyExecution(d,'receipt_inspect',{id:'po',receiptId:d.orders[0].receipts[0].id,expectedPending:20,accepted:12,rejected:0,note:'QC passed'},{...manager,id:'qc'});
  expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(0);
  applyExecution(d,'material_move',{id:'m',kind:'issue',taskId:'site',quantity:8,note:'Handed to installer'},manager);
  expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(2);
  const report=(id:string,quantity:number)=>applyExecution(d,'report_submit',{report:{id,date:'2026-09-22',shift:'Day',location:'site',entries:[{taskId:'site',quantity}],hours:1,people:1,summary:'Installed',evidence:'Site photo'}},manager);
  report('r1',2);applyExecution(d,'approve_report',{id:'r1'},{...manager,id:'qc'});
  report('r2',1);expect(()=>applyExecution(d,'approve_report',{id:'r2'},{...manager,id:'qc'})).toThrow('Only 2 chair');
  expect(d.reports[1].status).toBe('submitted');
  expect(()=>applyExecution(d,'material_move',{id:'m',kind:'return',taskId:'site',quantity:1,note:'Return'},manager)).toThrow('supports approved');
  applyExecution(d,'material_move',{id:'m',kind:'issue',taskId:'site',quantity:4,note:'Next chair'},manager);
  applyExecution(d,'approve_report',{id:'r2'},{...manager,id:'qc'});expect(d.tasks[0].approved).toBe(3);
  applyExecution(d,'installation_batch',{id:'site',title:'Room chairs — first three',quantity:3},manager);
  const batch=d.tasks[0].installationBatches![0];
  applyExecution(d,'installation_batch_review',{id:'site',batchId:batch.id,passed:true,note:'Installed chairs inspected'},{...manager,id:'qc'});
  d.documents=[{id:'care',title:'Care guide',kind:'manual',revision:'1',url:'',note:'',status:'approved',published:true,replaces:''}];
  applyExecution(d,'handover',{handover:{id:'partial',area:'Room',installationBatchIds:[batch.id]}},manager);
  applyExecution(d,'handover_status',{id:'partial',status:'ready',confirmed:true},manager);
  applyExecution(d,'handover_status',{id:'partial',status:'accepted',signedRecord:true,acceptedBy:'Client',note:'Signed acceptance for first three'},manager);
  expect(d.handovers[0].packet?.tasks[0]).toMatchObject({id:'site',quantity:3,unit:'chair'});
  expect(d.handovers[0].status).toBe('accepted');expect(d.tasks[0].status).toBe('in_progress');expect(d.orders[0].receipts[0].pending).toBe(8);
 });
 it('uses the limiting material and rejects missing or changed units',()=>{
  const d=fixture(),m=d.materials[0];m.movements=[{id:'i',kind:'issue',quantity:12,taskId:'site',at:'now',reference:'Issue'}];
  d.materials.push({...m,id:'second',title:'Seats',outputBasis:undefined,movements:[]});
  expect(installationMaterialCapacity(d,d.tasks[0]).issue).toContain('Seats');
  d.materials[1].outputBasis={...m.outputBasis!,perUnit:1};d.materials[1].movements=[{...m.movements[0],quantity:2}];
  expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(2);
  d.materials[1].movements[0].taskId='other';expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(0);
  d.tasks[0].unit='set';expect(installationMaterialCapacity(d,d.tasks[0]).issue).toContain('set');
 });
 it('locks the basis after issuing and permits only unused returns',()=>{
  const d=fixture(),m=d.materials[0];
  expect(()=>applyExecution(d,'material_output_basis',{id:'m',perUnit:0,note:'No'},manager)).toThrow();
  expect(()=>applyExecution(d,'material_output_basis',{id:'m',perUnit:1,note:'No'},{...manager,manage:false})).toThrow();
  m.movements=[{id:'r',kind:'receive',quantity:8,at:'now',reference:'QC'},{id:'i',kind:'issue',quantity:8,taskId:'site',at:'now',reference:'Issue'}];
  expect(()=>applyExecution(d,'material_output_basis',{id:'m',perUnit:1,note:'Change'},manager)).toThrow('before issuing');
  applyExecution(d,'material_move',{id:'m',kind:'return',taskId:'site',quantity:4,note:'Unused'},manager);
  expect(installationMaterialCapacity(d,d.tasks[0]).quantity).toBe(1);
 });
});
