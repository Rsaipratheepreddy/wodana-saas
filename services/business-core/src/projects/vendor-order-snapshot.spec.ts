import {describe,it,expect,vi} from 'vitest';
import {VendorOrderService} from './vendor-order.service';
import {emptyProject,applyExecution,type ExecutionActor} from './execution.domain';

describe('supplier portal frozen specification',()=>{
 it('returns the original request scope without exposing internal snapshot metadata',async()=>{
  const d=emptyProject();
  d.materials.push({id:'m',title:'Boards',specification:'Original oak',catalogId:'catalog',catalogVersion:3,required:5,unit:'sheet',supply:'company',taskId:'',needBy:'2026-09-25',movements:[]});
  const actor={id:'buyer',name:'Buyer',manage:true,buy:true,now:'2026-09-22',memberIds:[],resourceIds:[]} as ExecutionActor;
  applyExecution(d,'enquiry',{order:{id:'rfq',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',quantity:5,unit:'sheet',unitCost:0,promisedDate:'2026-09-25'}},actor);
  d.materials[0].specification='Changed pine';
  const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT * FROM project_vendor_access')?[{id:'grant',workspace_id:'w',project_id:'p',order_id:'rfq',attempts:0,window_at:new Date().toISOString()}]:sql.includes('SELECT content')?[{content:d}]:[]}));
  const db={query:vi.fn(async()=>({rows:[{workspace_id:'w'}]})),tenantTransaction:vi.fn(async(_w:string,_a:string,fn:(c:unknown)=>unknown)=>fn({query}))};
  const service=new VendorOrderService(db as never,{} as never,{} as never);
  const result=await service.handle({token:'a'.repeat(43),action:'read'});
  expect(result.order.specification).toBe('Original oak');
  expect(result.order).not.toHaveProperty('rfqSnapshot');expect(result.order).not.toHaveProperty('capturedBy');
  const submit={token:'a'.repeat(43),action:'submit',requestId:'quote',kind:'quotation',note:'Supplier offer',date:'2026-09-25',quantity:5,unitCost:10};
  await expect(service.handle({...submit,unitCost:0})).rejects.toThrow(/positive/);
  expect(d.orders[0].vendorUpdates).toBeUndefined();
  await service.handle(submit);
  expect(d.orders[0].vendorUpdates).toHaveLength(1);
  applyExecution(d,'award_enquiry',{id:'rfq',offerId:'quote',quantity:3,note:'Selected'},actor);
  await expect(service.handle({...submit,requestId:'revision'})).rejects.toThrow(/selection is closed/);
  expect(d.orders[0].vendorUpdates).toHaveLength(1);
  d.orders[0].status='cancelled';d.orders[0].replacedByRequestId='replacement';
  await expect(service.handle({...submit,requestId:'after-retirement'})).rejects.toThrow(/closed/);
  expect(d.orders[0].vendorUpdates).toHaveLength(1);
 });
});
