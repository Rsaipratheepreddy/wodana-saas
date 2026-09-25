import {describe,it,expect} from 'vitest';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
const actor:ExecutionActor={id:'buyer',name:'Buyer',manage:true,review:true,report:true,buy:true,memberIds:[],resourceIds:[],now:'2026-09-20T00:00:00Z',released:true};
const request={materialId:'m',quantity:5,quoteDueDate:'2026-09-22',promisedDate:'2026-09-25',suppliers:[{id:'s1',name:'Supplier 1',phone:'+971501234567'},{id:'s2',name:'Supplier 2'}]};
function setup(){const d=emptyProject();d.materials.push({id:'m',title:'Boards',specification:'Oak',catalogId:'',catalogVersion:0,required:5,unit:'sheet',supply:'company',taskId:'',needBy:'2026-09-25',movements:[]});return d;}
describe('supplier quote requests',()=>{
 it('creates separate supplier requests linked to the same requirement, without purchases',()=>{const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);expect(d.orders).toHaveLength(2);expect(d.orders.map(o=>o.vendorId)).toEqual(['s1','s2']);expect(new Set(d.orders.map(o=>o.quoteRequestId)).size).toBe(1);expect(d.orders.every(o=>o.status==='enquiry'&&o.materialId==='m'&&o.unitCost===0)).toBe(true);expect(d.orders[0].vendorPhone).toBe('+971501234567');expect(d.orders[0].quoteDueDate).toBe('2026-09-22');});
 it('blocks duplicate open requests without creating more rows',()=>{const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);expect(()=>applyExecution(d,'request_supplier_quotes',request,actor)).toThrow(/already exists/);expect(d.orders).toHaveLength(2);});
 it('rejects repeated supplier selection and unauthorized purchasing',()=>{const d=setup();expect(()=>applyExecution(d,'request_supplier_quotes',{...request,suppliers:[request.suppliers[0],request.suppliers[0]]},actor)).toThrow(/distinct/);expect(()=>applyExecution(d,'request_supplier_quotes',request,{...actor,buy:false})).toThrow(/permission/);expect(d.orders).toHaveLength(0);});
 it('rejects client supplied materials and invalid batches atomically',()=>{const d=setup();d.materials[0].supply='client';expect(()=>applyExecution(d,'request_supplier_quotes',request,actor)).toThrow(/supplied/);expect(d.orders).toHaveLength(0);d.materials[0].supply='company';expect(()=>applyExecution(d,'request_supplier_quotes',{...request,suppliers:[request.suppliers[0],{id:'bad',name:''}]},actor)).toThrow();expect(d.orders).toHaveLength(0);});
});

describe('frozen request scope',()=>{
 it('captures server scope and preserves it when requirements change',()=>{
  const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);
  const o=d.orders[0];expect(o.rfqSnapshot).toMatchObject({specification:'Oak',quantity:5,unit:'sheet',capturedBy:'buyer',materialId:'m'});
  d.materials[0].specification='Pine';d.materials[0].required=12;
  expect(o.rfqSnapshot?.specification).toBe('Oak');
  const before=structuredClone(d);
  expect(()=>applyExecution(d,'enquiry',{order:{...o,title:'Changed'}},actor)).toThrow(/frozen/);
  expect(d).toEqual(before);
 });
 it('keeps original scope on partial selection without approving or receiving',()=>{
  const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);const o=d.orders[0];
  applyExecution(d,'record_supplier_offer',{id:o.id,quantity:5,unitCost:10,promisedDate:'2026-09-26',evidence:'Q1'},actor);
  applyExecution(d,'award_enquiry',{id:o.id,offerId:o.vendorUpdates![0].id,quantity:2,note:'Partial offer'},actor);
  expect(o).toMatchObject({quantity:2,status:'draft',rfqSnapshot:{quantity:5,promisedDate:'2026-09-25'},receipts:[]});
  expect(d.materials[0].movements).toEqual([]);
  expect(()=>applyExecution(d,'order',{order:{...o,title:'Another item'}},actor)).toThrow(/selected request/);
 });
 it('does not partially select without a recorded offer',()=>{
  const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);const o=d.orders[0];const before=structuredClone(d);
  for(const input of [{unitCost:10,promisedDate:'bad'},{unitCost:0,promisedDate:'2026-09-26'}]){
   expect(()=>applyExecution(d,'award_enquiry',{id:o.id,quantity:2,note:'Selection',...input},actor)).toThrow();
   expect(d).toEqual(before);
  }
 });
});

describe('selected offer and split allocation',()=>{
 function quoted(){const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);for(const o of d.orders)applyExecution(d,'record_supplier_offer',{id:o.id,quantity:5,unitCost:10,promisedDate:'2026-09-26',evidence:'Q1'},actor);return d;}
 function select(d:ReturnType<typeof setup>,index:number,quantity:number){const o=d.orders[index];return applyExecution(d,'award_enquiry',{id:o.id,offerId:o.vendorUpdates!.at(-1)!.id,quantity,note:'Split allocation'},actor);}
 it('derives terms from the exact recorded offer and retains its evidence',()=>{const d=quoted(),o=d.orders[0];applyExecution(d,'award_enquiry',{id:o.id,offerId:o.vendorUpdates![0].id,quantity:2,unitCost:999,promisedDate:'2030-01-01',note:'Preferred supplier'},actor);expect(o).toMatchObject({status:'draft',quantity:2,unitCost:10,promisedDate:'2026-09-26',selectedOffer:{offerId:o.vendorUpdates![0].id,quotedQuantity:5,quantity:2,evidence:'Q1',selectedBy:'buyer',reason:'Preferred supplier'}});expect(o.receipts).toEqual([]);});
 it('rejects stale and foreign offers without altering the request',()=>{const d=quoted(),o=d.orders[0],oldId=o.vendorUpdates![0].id;applyExecution(d,'record_supplier_offer',{id:o.id,quantity:3,unitCost:12,promisedDate:'2026-09-27',evidence:'Q2'},actor);const before=structuredClone(d);for(const offerId of [oldId,d.orders[1].vendorUpdates![0].id]){expect(()=>applyExecution(d,'award_enquiry',{id:o.id,offerId,quantity:2,note:'Selection'},actor)).toThrow(/latest/);expect(d).toEqual(before);}select(d,0,2);expect(o.selectedOffer?.evidence).toBe('Q2');expect(o.vendorUpdates).toHaveLength(2);});
 it('blocks selection beyond supplier availability',()=>{const d=quoted(),o=d.orders[0];applyExecution(d,'record_supplier_offer',{id:o.id,quantity:2,unitCost:12,promisedDate:'2026-09-27',evidence:'Q2'},actor);const before=structuredClone(d);expect(()=>select(d,0,3)).toThrow(/offered quantity/);expect(d).toEqual(before);});
 it('counts draft selections across suppliers and permits exactly the remainder',()=>{const d=quoted();select(d,0,3);const before=structuredClone(d);expect(()=>select(d,1,3)).toThrow(/remaining request batch/);expect(d).toEqual(before);select(d,1,2);expect(d.orders.map(o=>o.quantity)).toEqual([3,2]);expect(d.orders.every(o=>o.status==='draft')).toBe(true);});
 it('checks allocation again when editing a selected draft',()=>{const d=quoted();select(d,0,3);select(d,1,2);const before=structuredClone(d);expect(()=>applyExecution(d,'order',{order:{...d.orders[0],quantity:4}},actor)).toThrow(/remaining request batch/);expect(d).toEqual(before);});
 it('locks the selected quote terms while allowing quantity reductions',()=>{const d=quoted();select(d,0,3);const o=d.orders[0],before=structuredClone(d);for(const change of [{unitCost:99},{promisedDate:'2026-10-01'}])expect(()=>applyExecution(d,'order',{order:{...o,...change}},actor)).toThrow(/selected quote/);expect(d).toEqual(before);applyExecution(d,'order',{order:{...o,quantity:2}},actor);expect(o.quantity).toBe(2);expect(o.selectedOffer?.quantity).toBe(3);});
 it('releases cancelled selection quantities and preserves historical evidence',()=>{const d=quoted();select(d,0,3);applyExecution(d,'order_status',{id:d.orders[0].id,status:'cancelled',note:'Supplier unavailable'},actor);select(d,1,5);expect(d.orders[0].selectedOffer?.quantity).toBe(3);expect(d.orders[1].quantity).toBe(5);});
 it('rejects invalid offers atomically and enforces buyer permission',()=>{const d=quoted(),o=d.orders[0],before=structuredClone(d);for(const value of [{quantity:6},{unitCost:0},{promisedDate:'invalid'},{evidence:''}])expect(()=>applyExecution(d,'record_supplier_offer',{id:o.id,quantity:5,unitCost:10,promisedDate:'2026-09-26',evidence:'Q2',...value},actor)).toThrow();expect(d).toEqual(before);expect(()=>applyExecution(d,'award_enquiry',{id:o.id,offerId:o.vendorUpdates![0].id,quantity:2,note:'Selected'},{...actor,buy:false})).toThrow(/Procurement/);expect(d).toEqual(before);});
});

describe('linked RFQ replacement',()=>{
 function requested(){const d=setup();applyExecution(d,'request_supplier_quotes',request,actor);return d;}
 function replace(d:ReturnType<typeof setup>,id=d.orders[0].id,extra={}){return applyExecution(d,'replace_enquiry',{id,supplier:{vendor:'Supplier 1',vendorContact:''},quoteDueDate:'2026-09-24',promisedDate:'2026-09-28',note:'Updated specification',...extra},actor);}
 it('retains old offers and scope while creating a linked fresh request',()=>{const d=requested(),old=d.orders[0];applyExecution(d,'record_supplier_offer',{id:old.id,quantity:5,unitCost:10,promisedDate:'2026-09-25',evidence:'Q1'},actor);d.materials[0].specification='Pine';replace(d);const retired=d.orders[0],next=d.orders.at(-1)!;expect(retired).toMatchObject({status:'cancelled',replacedByRequestId:next.id,rfqSnapshot:{specification:'Oak'}});expect(retired.vendorUpdates).toHaveLength(1);expect(next).toMatchObject({status:'enquiry',replacesRequestId:old.id,quoteRequestId:old.quoteRequestId,quantity:5,unitCost:0,replacementReason:'Updated specification',replacementBy:'buyer',rfqSnapshot:{specification:'Pine',promisedDate:'2026-09-28'}});expect(next.vendorUpdates).toBeUndefined();expect(next.selectedOffer).toBeUndefined();expect(next.number).not.toBe(old.number);});
 it('allows another revision only from the latest request',()=>{const d=requested();replace(d);const second=d.orders.at(-1)!.id;expect(()=>replace(d)).toThrow(/latest/);replace(d,second);expect(d.orders.at(-1)?.replacesRequestId).toBe(second);expect(d.orders.find(o=>o.id===second)?.replacedByRequestId).toBe(d.orders.at(-1)?.id);});
 it('rejects invalid replacement without retiring the original',()=>{const d=requested(),before=structuredClone(d);for(const extra of [{note:''},{quoteDueDate:'invalid'},{promisedDate:''}]){expect(()=>replace(d,d.orders[0].id,extra)).toThrow();expect(d).toEqual(before);}});
 it('blocks changed units, consuming tasks, client supply and active selections',()=>{for(const patch of [{unit:'box'},{taskId:'different'},{supply:'client' as const}]){const d=requested();Object.assign(d.materials[0],patch);const before=structuredClone(d);expect(()=>replace(d)).toThrow();expect(d).toEqual(before);}const d=requested(),other=d.orders[1];applyExecution(d,'record_supplier_offer',{id:other.id,quantity:5,unitCost:10,promisedDate:'2026-09-25',evidence:'Q1'},actor);applyExecution(d,'award_enquiry',{id:other.id,offerId:other.vendorUpdates![0].id,quantity:2,note:'Selected'},actor);const before=structuredClone(d);expect(()=>replace(d)).toThrow(/supplier selections/);expect(d).toEqual(before);});
 it('allows cancelled unselected requests but rejects awarded and legacy records',()=>{const d=requested();d.orders[0].status='cancelled';replace(d);const other=requested();other.orders[0].sourceEnquiry='RFQ-1';expect(()=>replace(other)).toThrow(/unselected/);delete other.orders[0].sourceEnquiry;delete other.orders[0].rfqSnapshot;expect(()=>replace(other)).toThrow(/legacy/);});
});
