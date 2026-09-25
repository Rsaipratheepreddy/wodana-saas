import {describe,it,expect} from 'vitest';
import {emptyProject,applyExecution,type ExecutionActor} from './execution.domain';
import type {Order} from './execution.types';
const buyer={id:'buyer',name:'Buyer',buy:true,review:false,released:true,now:'2026-09-22',memberIds:[],resourceIds:[],reviewerIds:['reviewer']} as ExecutionActor;
const reviewer={...buyer,id:'reviewer',name:'Reviewer',buy:false,review:true};
function setup(){const d=emptyProject();d.budget=1000;d.orders=[{id:'o',number:'PO-1',title:'Boards',vendor:'Supplier',vendorContact:'',kind:'material',materialId:'',taskId:'',quantity:5,unit:'sheet',unitCost:10,currency:'AED',promisedDate:'2026-09-25',status:'acknowledged',acknowledgement:'Original confirmation',receipts:[]} as Order];return d;}
function propose(d:ReturnType<typeof setup>){applyExecution(d,'order_amendment',{id:'o',reviewerId:'reviewer',dueDate:'2026-09-24',unitCost:12,promisedDate:'2026-09-28',note:'Supplier price revision',evidence:'Q2'},buyer);return d.orders[0].amendments!.at(-1)!.id;}
function decide(d:ReturnType<typeof setup>,amendmentId:string,decision='approved',actor=reviewer){applyExecution(d,'order_amendment_decide',{id:'o',amendmentId,decision,note:'Reviewed'},actor);}
describe('controlled order amendments',()=>{
 it('reassigns pending reviews with history and immediately revokes the old reviewer',()=>{
  const d=setup(),id=propose(d),before=structuredClone(d.orders[0]);
  applyExecution(d,'order_amendment_assign',{id:'o',amendmentId:id,reviewerId:'new-reviewer',dueDate:'2026-09-26',note:'Reviewer on leave'},{...buyer,reviewerIds:['new-reviewer']});
  expect(d.orders[0].unitCost).toBe(before.unitCost);expect(d.orders[0].status).toBe(before.status);
  expect(d.orders[0].amendments![0]).toMatchObject({id,status:'submitted',reviewerId:'new-reviewer',dueDate:'2026-09-26',before:before.amendments![0].before,after:before.amendments![0].after,assignments:[{fromReviewerId:'reviewer',toReviewerId:'new-reviewer',by:'buyer',reason:'Reviewer on leave'}]});
  expect(()=>decide(d,id)).toThrow(/assigned reviewer/);decide(d,id,'approved',{...reviewer,id:'new-reviewer'});expect(d.orders[0].unitCost).toBe(12);
 });
 it('lets a project manager recover an unassigned proposal without its creator',()=>{
  const d=setup(),id=propose(d);delete d.orders[0].amendments![0].reviewerId;delete d.orders[0].amendments![0].dueDate;
  applyExecution(d,'order_amendment_assign',{id:'o',amendmentId:id,reviewerId:'reviewer',dueDate:'2026-09-26',note:'Recover orphaned review'},{...reviewer,id:'manager',manage:true});
  expect(d.orders[0].amendments![0].assignments![0]).toMatchObject({fromReviewerId:'',fromDueDate:'',by:'manager'});
 });
 it('rejects unauthorized, self-review, inactive, no-op and incomplete assignments atomically',()=>{
  const d=setup(),id=propose(d),before=structuredClone(d),input={id:'o',amendmentId:id,reviewerId:'reviewer',dueDate:'2026-09-26',note:'Reschedule'};
  expect(()=>applyExecution(d,'order_amendment_assign',input,reviewer)).toThrow(/project manager/);
  for(const patch of [{reviewerId:'buyer'},{reviewerId:'inactive'},{dueDate:'2026-09-24'},{dueDate:'bad'},{note:''}])expect(()=>applyExecution(d,'order_amendment_assign',{...input,...patch},buyer)).toThrow();
  expect(d).toEqual(before);decide(d,id);expect(()=>applyExecution(d,'order_amendment_assign',input,buyer)).toThrow(/pending/);
 });
 it('requires an eligible reviewer and rejects another reviewer',()=>{
  const d=setup();for(const reviewerId of ['buyer','outsider','']){const before=structuredClone(d);expect(()=>applyExecution(d,'order_amendment',{id:'o',unitCost:12,promisedDate:'2026-09-28',note:'Change',evidence:'Q2',reviewerId,dueDate:'2026-09-24'},buyer)).toThrow();expect(d).toEqual(before);}
  const id=propose(d),before=structuredClone(d);expect(()=>decide(d,id,'approved',{...reviewer,id:'another-reviewer'})).toThrow(/assigned reviewer/);expect(d).toEqual(before);
 });
 it('keeps live terms until independent approval and resets supplier acknowledgement',()=>{const d=setup(),id=propose(d);expect(d.orders[0]).toMatchObject({unitCost:10,promisedDate:'2026-09-25',status:'acknowledged'});decide(d,id);expect(d.orders[0]).toMatchObject({unitCost:12,promisedDate:'2026-09-28',status:'approved',acknowledgement:'',baselinePromisedDate:'2026-09-25'});expect(d.orders[0].amendments![0]).toMatchObject({status:'approved',decidedBy:'reviewer',before:{unitCost:10},after:{unitCost:12}});});
 it('rejects self approval and missing review permission without changing anything',()=>{const d=setup(),id=propose(d),before=structuredClone(d);for(const actor of [buyer,{...buyer,review:true}]){expect(()=>decide(d,id,'approved',actor)).toThrow();expect(d).toEqual(before);}});
 it('counts other commitments but replaces the existing order value in budget checks',()=>{const d=setup();d.budget=60;const id=propose(d);decide(d,id);const other=setup();other.orders.push({...other.orders[0],id:'other',quantity:95});const aid=propose(other),before=structuredClone(other);expect(()=>decide(other,aid)).toThrow(/budget/);expect(other).toEqual(before);});
 it('rechecks fulfilment, release, final account and changed terms at approval',()=>{for(const change of [(d:ReturnType<typeof setup>)=>{d.orders[0].receipts.push({id:'r',accepted:1,rejected:0,evidence:'DN1',at:buyer.now});},(d:ReturnType<typeof setup>)=>{d.financeClosed=true;},(d:ReturnType<typeof setup>)=>{d.orders[0].promisedDate='2026-09-27';},(d:ReturnType<typeof setup>)=>{d.orders[0].status='cancelled';}]){const d=setup(),id=propose(d);change(d);const before=structuredClone(d);expect(()=>decide(d,id)).toThrow();expect(d).toEqual(before);}const d=setup(),id=propose(d),before=structuredClone(d);expect(()=>decide(d,id,'approved',{...reviewer,released:false})).toThrow();expect(d).toEqual(before);});
 it('rejects duplicate pending proposals and no-op or invalid proposals',()=>{const d=setup();for(const patch of [{unitCost:0},{promisedDate:'invalid'},{evidence:''},{unitCost:10,promisedDate:'2026-09-25'}]){const before=structuredClone(d);expect(()=>applyExecution(d,'order_amendment',{id:'o',unitCost:12,promisedDate:'2026-09-28',note:'Change',evidence:'Q2',...patch},buyer)).toThrow();expect(d).toEqual(before);}propose(d);expect(()=>propose(d)).toThrow(/pending/);});
 it('retains rejected/withdrawn history without changing live terms and prevents repeat decisions',()=>{const d=setup(),id=propose(d);decide(d,id,'rejected');expect(d.orders[0].unitCost).toBe(10);expect(()=>decide(d,id)).toThrow(/already/);const next=propose(d);expect(()=>decide(d,next,'withdrawn',reviewer)).toThrow();decide(d,next,'withdrawn',buyer);expect(d.orders[0].amendments?.map(a=>a.status)).toEqual(['rejected','withdrawn']);expect(d.orders[0].unitCost).toBe(10);});
 it('blocks proposals after invoice or shipment records exist',()=>{const d=setup();d.orders[0].shipments=[{id:'ship',at:buyer.now,status:'preparing',carrier:'',reference:'S1',quantity:5,expectedDate:'2026-09-25',note:''}];expect(()=>propose(d)).toThrow(/fulfilment/);d.orders[0].shipments=[];d.supplierInvoices=[{orderId:'o'} as never];expect(()=>propose(d)).toThrow(/fulfilment/);});
});
