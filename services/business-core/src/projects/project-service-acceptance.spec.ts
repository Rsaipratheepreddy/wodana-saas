import { expect, it } from 'vitest';
import { applyExecution, emptyProject, type ExecutionActor } from './execution.domain';
import type { Task } from './execution.types';
const actor:ExecutionActor={id:'buyer',name:'Buyer',manage:true,buy:true,report:true,review:true,memberIds:['buyer','reviewer'],resourceIds:[],released:true,now:'2026-09-22T10:00:00Z'};
function fixture() {
 const data=emptyProject(); data.phase='active';
 data.tasks=[{id:'painting',title:'Paint walls',unit:'m2',quantity:10,approved:4,status:'in_progress',inspectionRequired:false,location:'site'} as Task];
 data.reports=[{id:'output',date:'2026-09-22',shift:'Day',location:'site',authorId:'buyer',author:'Buyer',status:'approved',entries:[{taskId:'painting',quantity:4}],hours:2,people:1,materials:'',issues:'',tomorrow:'Continue',evidence:'Measured output',note:''}];
 data.orders=[{id:'order',number:'PO-1',title:'Painting labour',vendor:'Painter',vendorContact:'',kind:'subcontract',taskId:'painting',materialId:'',quantity:10,unit:'m2',unitCost:20,currency:'AED',promisedDate:'2026-09-22',status:'acknowledged',acknowledgement:'Confirmed',receipts:[]}];
 return data;
}
it('accepts measured partial service and prevents duplicate certification across orders',()=>{
 const data=fixture();
 applyExecution(data,'receipt',{id:'order',accepted:3,rejected:0,note:'Measured three square metres'},actor);
 expect(data.orders[0].receipts[0]).toMatchObject({basis:'service',serviceBasis:{taskId:'painting',unit:'m2',approvedQuantity:4}});
 data.orders.push({...data.orders[0],id:'second',number:'PO-2',receipts:[]});
 expect(()=>applyExecution(data,'receipt',{id:'second',accepted:2,rejected:0,note:'Duplicate work'},actor)).toThrow('Only 4 m2');
 expect(data.orders[1].receipts).toHaveLength(0);
});
it('requires the linked unit and completed inspection before service acceptance',()=>{
 const data=fixture(); data.orders[0].unit='job';
 expect(()=>applyExecution(data,'receipt',{id:'order',accepted:1,rejected:0,note:'Measured'},actor)).toThrow('units must match');
 data.orders[0].unit='m2'; data.tasks[0].inspectionRequired=true;
 expect(()=>applyExecution(data,'receipt',{id:'order',accepted:1,rejected:0,note:'Measured'},actor)).toThrow('Only 0 m2');
});
it('preserves certified service quantity when a progress correction is reviewed',()=>{
 const data=fixture();
 applyExecution(data,'receipt',{id:'order',accepted:3,rejected:0,note:'Certified work'},actor);
 data.reports.push({...data.reports[0],id:'correction',status:'submitted',supersedes:'output',entries:[{taskId:'painting',quantity:2}]});
 expect(()=>applyExecution(data,'approve_report',{id:'correction'},{...actor,id:'reviewer'})).toThrow('accepted subcontract work');
 expect(data.reports[1].status).toBe('submitted');
 expect(data.tasks[0].approved).toBe(4);
});
it('enforces approved work on pending inspection and invoice approval too',()=>{
 const data=fixture();
 applyExecution(data,'receipt',{id:'order',received:6,accepted:0,rejected:0,pending:6,note:'Claim pending certification'},actor);
 expect(()=>applyExecution(data,'receipt_inspect',{id:'order',receiptId:data.orders[0].receipts[0].id,expectedPending:6,accepted:5,rejected:0,note:'Measured'},{...actor,id:'reviewer'})).toThrow('Only 4 m2');
 // Historical receipts must not bypass the output check at invoice approval.
 data.orders[0].receipts[0].accepted=5; data.orders[0].receipts[0].pending=1;
 applyExecution(data,'supplier_invoice',{orderId:'order',number:'INV1',date:'2026-09-22',dueDate:'2026-09-23',quantity:5,unitCost:20,tax:0,evidence:'Synthetic invoice'},actor);
 expect(()=>applyExecution(data,'approve_supplier_invoice',{id:data.supplierInvoices![0].id},actor)).toThrow('Only 4 m2');
});
