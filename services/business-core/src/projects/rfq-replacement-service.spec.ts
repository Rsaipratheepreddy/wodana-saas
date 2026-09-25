import {describe,it,expect,vi} from 'vitest';
import {ExecutionService} from './execution.service';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
const vendorId='11111111-1111-4111-8111-111111111111';
describe('replacement supplier resolution',()=>{
 it('uses the original workspace supplier and rejects an inactive or foreign supplier before mutation',async()=>{
  const data=emptyProject();data.materials.push({id:'m',title:'Boards',specification:'Oak',catalogId:'',catalogVersion:0,required:5,unit:'sheet',supply:'company',taskId:'',needBy:'2026-09-25',movements:[]});
  applyExecution(data,'enquiry',{order:{id:'rfq',vendorId,vendor:'Supplier',title:'Boards',materialId:'m',kind:'material',quantity:5,unit:'sheet',unitCost:0,promisedDate:'2026-09-25'}},{id:'buyer',name:'Buyer',buy:true,now:'2026-09-22'} as ExecutionActor);
  const query=vi.fn(async()=>({rows:[]}));
  const service=new ExecutionService({run:async(_a:unknown,w:string,fn:(ctx:unknown)=>unknown)=>fn({workspaceId:w,client:{query}}),require:vi.fn()} as never,{} as never,{} as never);
  vi.spyOn(service,'row').mockResolvedValue({id:'p'} as never);vi.spyOn(service,'load').mockResolvedValue(data);const store=vi.spyOn(service,'store').mockResolvedValue(undefined);
  const before=structuredClone(data);
  await expect(service.command({sub:'buyer'} as never,'workspace','p',{action:'replace_enquiry',id:'rfq',revision:0,requestId:'replacement-request-001',vendorIds:['another-vendor'],supplier:{vendor:'Forged supplier'}})).rejects.toThrow(/active suppliers/);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("v.workspace_id=$1"),['workspace',[vendorId]]);expect(store).not.toHaveBeenCalled();expect(data).toEqual(before);
 });
});
