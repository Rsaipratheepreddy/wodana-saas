import { describe, expect, it } from 'vitest';
import { applyExecution, emptyProject, type ExecutionActor } from './execution.domain';
import { materialInventory } from './project-inventory';
const buyer:ExecutionActor={id:'buyer',name:'Buyer',manage:true,review:true,report:true,buy:true,memberIds:['buyer','qc'],resourceIds:[],released:true,now:'2026-09-22T10:00:00Z'};
const reviewer={...buyer,id:'qc',buy:false};
function fixture(){
 const d=emptyProject();
 d.materials=[{id:'m',title:'Boards',specification:'',catalogId:'',catalogVersion:0,unit:'sheet',required:10,supply:'company',taskId:'',needBy:'2026-09-22',movements:[]}];
 d.orders=[{id:'po',number:'PO-1',title:'Boards',vendor:'Supplier',vendorContact:'',kind:'material',materialId:'m',taskId:'',quantity:10,unit:'sheet',unitCost:20,currency:'AED',promisedDate:'2026-09-22',status:'acknowledged',acknowledgement:'Confirmed',receipts:[]}];
 applyExecution(d,'receipt',{id:'po',received:10,accepted:0,rejected:0,pending:10,note:'DN-1'},buyer);
 return d;
}
describe('pending receipt inspection',()=>{
 it('binds QC evidence to the order and rejects a foreign file before accepting stock',()=>{
  const d=fixture(),r=d.orders[0].receipts[0];d.files=[{id:'f',recordId:'po',name:'qc.png',mimeType:'image/png',bytes:1,sha256:'hash',by:'qc',at:reviewer.now}];
  const b={id:'po',receiptId:r.id,expectedPending:10,accepted:2,rejected:0,note:'QC photo',fileIds:['missing']};
  expect(()=>applyExecution(d,'receipt_inspect',b,reviewer)).toThrow('this record');expect(r.pending).toBe(10);expect(d.materials[0].movements).toHaveLength(0);
  applyExecution(d,'receipt_inspect',{...b,fileIds:['f']},reviewer);expect(r.inspections?.[0].evidenceFiles?.[0]).toMatchObject({id:'f',sha256:'hash'});
 });
 it('quarantines arrivals and adds only incremental accepted stock',()=>{
  const d=fixture(),r=d.orders[0].receipts[0];
  expect(materialInventory(d.materials[0]).available).toBe(0);
  const inspect={id:'po',receiptId:r.id,expectedPending:10,accepted:4,rejected:2,note:'QC report 1'};
  applyExecution(d,'receipt_inspect',inspect,reviewer);
  expect(r).toMatchObject({accepted:4,rejected:2,pending:4});
  expect(materialInventory(d.materials[0]).available).toBe(4);
  expect(()=>applyExecution(d,'receipt_inspect',inspect,reviewer)).toThrow('changed');
  applyExecution(d,'receipt_inspect',{...inspect,expectedPending:4,accepted:3,rejected:1},reviewer);
  expect(r).toMatchObject({accepted:7,rejected:3,pending:0});
  expect(r.inspections).toHaveLength(2);
  expect(materialInventory(d.materials[0]).available).toBe(7);
  applyExecution(d,'receipt',{id:'po',received:3,accepted:0,rejected:0,pending:3,note:'Replacement'},buyer);
  expect(()=>applyExecution(d,'receipt',{id:'po',accepted:1,rejected:0,note:'Extra'},buyer)).toThrow('ordered quantity');
 });
 it('requires an independent authorized reviewer and valid evidence/quantities',()=>{
  const d=fixture(),b={id:'po',receiptId:d.orders[0].receipts[0].id,expectedPending:10,accepted:2,rejected:0,note:'QC'};
  expect(()=>applyExecution(d,'receipt_inspect',b,buyer)).toThrow('different reviewer');
  expect(()=>applyExecution(d,'receipt_inspect',b,{...reviewer,review:false})).toThrow();
  for(const change of [{accepted:11},{note:''},{expectedPending:undefined},{accepted:0}]) expect(()=>applyExecution(d,'receipt_inspect',{...b,...change},reviewer)).toThrow();
  expect(d.materials[0].movements).toHaveLength(0);
 });
 it('does not allow pending goods to close receiving or approve an invoice',()=>{
  const d=fixture();
  expect(()=>applyExecution(d,'order_status',{id:'po',status:'closed',confirmed:true,note:'Close'},buyer)).toThrow('remaining quantity');
  applyExecution(d,'supplier_invoice',{orderId:'po',number:'INV1',date:'2026-09-22',dueDate:'2026-09-30',quantity:10,unitCost:20,tax:0,evidence:'Invoice'},buyer);
  expect(()=>applyExecution(d,'approve_supplier_invoice',{id:d.supplierInvoices![0].id},reviewer)).toThrow('accepted');
 });
});
