import {describe,it,expect,vi} from 'vitest';
import {ForbiddenException} from '@nestjs/common';
import {emptyProject} from './execution.domain';
import type {Task,ProjectData} from './execution.types';
import {ProjectFactoryBatchesService} from './project-factory-batches.service';
import {factoryTaskSnapshot} from './project-factory-batches';
vi.mock('./project-readiness',()=>({commercialExecutionReady:(value:unknown)=>Boolean(value)}));
const w='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',r='33333333-3333-4333-8333-333333333333',o='44444444-4444-4444-8444-444444444444';
function setup(manage=true){
 const data=emptyProject();data.tasks=[{id:'task',location:'factory',status:'planned',quantity:4,unit:'wardrobe',approved:0,resourceId:r,ownerId:o,scopeIds:[],start:'2026-09-22',end:'2026-09-23',title:'Wardrobes',area:'Room',drawingId:''} as Task];
 data.tasks[0].scopeIds=['boq'];data.scope={lines:[{id:'boq',title:'Wardrobes',quantity:4,unit:'wardrobe'}]} as ProjectData['scope'];
 const query=vi.fn(async(sql:string,_args?:unknown[]):Promise<{rows:any[];rowCount:number}>=>{
  if(sql.includes('SELECT name FROM project_resources'))return {rows:[{name:'Workshop'}],rowCount:1};
  if(sql.includes('SELECT u.display_name AS name'))return {rows:[{name:'Foreman'}],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const ctx={client:{query},workspaceId:w,membershipId:o,permissions:new Set(manage?['projects.manage']:['projects.view'])};
 const access={run:vi.fn(async(_actor:unknown,_workspace:unknown,fn:(value:typeof ctx)=>unknown)=>fn(ctx)),require:vi.fn((context:{permissions:Set<string>},...codes:string[])=>{if(!codes.some(code=>context.permissions.has(code)))throw new ForbiddenException();})};
 const execution={row:vi.fn(async()=>({id:p,name:'Villa',commercial:true,status:'active'})),load:vi.fn(async()=>data)};
 const service=new ProjectFactoryBatchesService(access as never,execution as never);
 const body={action:'create',requestId:'55555555-5555-4555-8555-555555555555',name:'Wardrobes run',operation:'Assembly',compatibility:'Same construction',resourceId:r,ownerId:o,tasks:[{projectId:p,taskId:'task',revision:data.revision}]};
 return {service,body,data,query,execution,ctx};
}
describe('factory batch transaction boundaries',()=>{
 it('rejects a retry key reused for different data',async()=>{
  const {service,body,query}=setup();query.mockImplementation(async sql=>sql.includes('SELECT payload_hash')?{rows:[{payload_hash:'different',batch_id:r}],rowCount:1}:{rows:[],rowCount:0});
  await expect(service.command({} as never,w,body)).rejects.toThrow(/Request key/);
  expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
 });
 it('refuses cancellation once output exists, leaving allocation ownership intact',async()=>{
  const {service,data,query}=setup();data.tasks[0].approved=1;
  query.mockImplementation(async sql=>{
   if(sql.includes('SELECT content,version'))return {rows:[{content:{id:r},version:1}],rowCount:1};
   if(sql.includes('SELECT project_id,task_id FROM project_factory_allocations'))return {rows:[{project_id:p,task_id:'task'}],rowCount:1};
   return {rows:[],rowCount:0};
  });
  await expect(service.command({} as never,w,{action:'cancel',requestId:o,id:r,version:1,reason:'Regroup'})).rejects.toThrow(/history/);
  expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
 });
 it('cancels unstarted allocations with version and reason history',async()=>{
  const {service,query}=setup();query.mockImplementation(async sql=>{
   if(sql.includes('SELECT content,version'))return {rows:[{content:{id:r},version:1}],rowCount:1};
   if(sql.includes('SELECT project_id,task_id FROM project_factory_allocations'))return {rows:[{project_id:p,task_id:'task'}],rowCount:1};
   return {rows:[],rowCount:0};
  });
  await service.command({} as never,w,{action:'cancel',requestId:o,id:r,version:1,reason:'Regroup'});
  const update=query.mock.calls.find(([sql])=>sql.startsWith('UPDATE project_factory_batches'))!;
  expect(JSON.parse(String(update[1]![2])).cancelled.reason).toBe('Regroup');
  expect(query.mock.calls.some(([sql])=>sql.includes('SET active=false'))).toBe(true);
 });
 it('requires management for global reads and mutations',async()=>{
  const {service,body}=setup(false);
  await expect(service.state({} as never,w)).rejects.toThrow(ForbiddenException);
  await expect(service.command({} as never,w,body)).rejects.toThrow(ForbiddenException);
 });
 it('scopes project reads before loading allocations and omits creation choices',async()=>{
  const {service,query,execution}=setup(false);const result=await service.state({} as never,w,p);
  expect(execution.row).toHaveBeenCalled();expect(result.canManage).toBe(false);expect(result.candidates).toEqual([]);
  expect(query.mock.calls[0][1]).toEqual([w,p]);
 });
 it('persists one frozen allocation after locking project rows',async()=>{
  const {service,body,query,execution}=setup();await service.command({} as never,w,body);
  expect(execution.row).toHaveBeenCalledWith(expect.anything(),p,true);
  const insert=query.mock.calls.find(([sql])=>sql.includes('INSERT INTO project_factory_allocations'))!;
  expect(JSON.parse(String(insert[1]![4])).snapshot.quantity).toBe(4);
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO project_factory_commands'))).toBe(true);
 });
 it('rejects stale, duplicate and unreleased source requests before persistence',async()=>{
  const {service,body,query,execution}=setup();
  await expect(service.command({} as never,w,{...body,tasks:[{...body.tasks[0],revision:-1}]})).rejects.toThrow(/changed/);
  await expect(service.command({} as never,w,{...body,tasks:[...body.tasks,...body.tasks]})).rejects.toThrow(/once/);
  execution.row.mockResolvedValueOnce({id:p,name:'Villa',commercial:false,status:'active'});
  await expect(service.command({} as never,w,body)).rejects.toThrow(/released/);
  expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
 });
 it('rejects a task already assigned to a batch',async()=>{
  const {service,body,query}=setup();const original=query.getMockImplementation()!;
  query.mockImplementation(async(sql,args)=>sql.includes('SELECT 1 FROM project_factory_allocations')?{rows:[{}],rowCount:1}:original(sql,args));
  await expect(service.command({} as never,w,body)).rejects.toThrow(/already belongs/);
 });
 it('does not attribute new production to a cancelled historical batch',async()=>{
  const {service,data,query}=setup(false);const snapshot={projectId:p,projectName:'Villa',revision:0,snapshot:factoryTaskSnapshot(data,data.tasks[0])};
  data.tasks[0].approved=4;
  query.mockImplementation(async sql=>sql.includes('SELECT b.id')?{rows:[{id:r,project_id:p,version:2,content:{id:r,cancelled:{reason:'Regroup'}},snapshot}],rowCount:1}:{rows:[],rowCount:0});
  const result=await service.state({} as never,w,p);expect(result.batches[0].allocations[0].approved).toBe(0);
 });
 it.each([
  ['2026-09-22','2026-09-23',true],
  ['2026-09-22','2026-09-22',false],
  ['2026-09-23','2026-09-24',false],
 ])('requires a booking covering all current task dates (%s to %s)',async(start,end,booked)=>{
  const {service,data,query}=setup(false);const snapshot={projectId:p,projectName:'Villa',revision:0,snapshot:factoryTaskSnapshot(data,data.tasks[0])};
  query.mockImplementation(async sql=>{
   if(sql.includes('SELECT b.id'))return {rows:[{id:r,project_id:p,version:1,content:{id:r},snapshot}],rowCount:1};
   if(sql.includes('FROM project_bookings'))return {rows:[{project_id:p,task_id:'task',resource_id:r,start,end}],rowCount:1};
   return {rows:[],rowCount:0};
  });
  const result=await service.state({} as never,w,p);expect(result.batches[0].allocations[0].booked).toBe(booked);
 });
});
