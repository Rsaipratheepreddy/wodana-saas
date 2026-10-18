import {describe,it,expect} from 'vitest';
import {emptyProject} from './execution.domain';
import type {Task} from './execution.types';
import type {Dispatch} from './execution-controls.types';
import {assertCompatibleFactoryTasks,assertFactoryScope,assertUnstartedFactoryTask,factoryTaskSnapshot,factoryAllocationView,factoryBatchState,type FactoryAllocation,type FactoryBatch} from './project-factory-batches';

export function fixture(){
 const data=emptyProject();
 const task:Task={id:'task',parentId:'',package:'Wardrobes',title:'Build wardrobes',description:'',area:'Bedroom',location:'factory',ownerId:'owner',assigneeIds:[],resourceId:'factory',start:'2026-09-22',end:'2026-09-23',baselineStart:'2026-09-22',baselineEnd:'2026-09-23',predecessors:[],quantity:6,unit:'wardrobe',weight:1,approved:0,status:'planned',priority:'normal',inspectionRequired:true,scopeIds:[],drawingId:'',readiness:{scope:true,access:true,materials:true},blocker:''};
 data.tasks=[task];
 const allocation:FactoryAllocation={projectId:'project',projectName:'Villa',revision:data.revision,snapshot:structuredClone(factoryTaskSnapshot(data,task))};
 return {data,task,allocation};
}
describe('shared factory batch quantities and lineage',()=>{
 it('requires a resolvable released BOQ reference',()=>{
  const {allocation}=fixture();expect(()=>assertFactoryScope(allocation.snapshot)).toThrow(/BOQ/);
  allocation.snapshot.scopeIds=['missing'];expect(()=>assertFactoryScope(allocation.snapshot)).toThrow(/BOQ/);
 });
 it('does not extend an earlier QC pass to newly approved output',()=>{
  const {data,task,allocation}=fixture();task.approved=4;task.inspections=[{id:'qc',by:'other',at:'now',passed:true,quantity:2,unit:task.unit,evidence:'First output'}];
  expect(factoryAllocationView(allocation,data,true).qc).toBe('pending');
 });
 it('accepts compatible whole tasks and rejects mixed resources or units',()=>{
  const {allocation}=fixture();assertCompatibleFactoryTasks([allocation],'factory');
  expect(()=>assertCompatibleFactoryTasks([allocation],'other')).toThrow(/workshop/);
  expect(()=>assertCompatibleFactoryTasks([allocation,{...allocation,snapshot:{...allocation.snapshot,unit:'sheet'}}],'factory')).toThrow(/unit/);
 });
 it('blocks grouping or cancelling started work and parent tasks',()=>{
  const {data,task}=fixture();assertUnstartedFactoryTask(data,task);
  task.approved=1;expect(()=>assertUnstartedFactoryTask(data,task)).toThrow();task.approved=0;
  data.tasks.push({...task,id:'child',parentId:task.id});expect(()=>assertUnstartedFactoryTask(data,task)).toThrow();data.tasks.pop();
  data.reports.push({entries:[{taskId:task.id,quantity:0}]} as typeof data.reports[number]);expect(()=>assertUnstartedFactoryTask(data,task)).toThrow();
 });
 it('flags source edits but not ordinary approved progress or JSON key order',()=>{
  const {data,task,allocation}=fixture();
  allocation.snapshot=Object.fromEntries(Object.entries(allocation.snapshot).reverse()) as typeof allocation.snapshot;
  task.approved=2;task.status='in_progress';expect(factoryAllocationView(allocation,data,true).changed).toBe(false);
  task.quantity=7;expect(factoryAllocationView(allocation,data,true).changed).toBe(true);
 });
 it('tracks ten wardrobes across projects without mixing their deliveries',()=>{
  const first=fixture(),second=fixture();second.task.quantity=4;second.allocation={...second.allocation,projectId:'other',snapshot:factoryTaskSnapshot(second.data,second.task)};
  const batch={} as FactoryBatch;
  first.task.approved=6;first.task.status='completed';first.task.inspections=[{id:'qc',by:'reviewer',at:'now',passed:true,quantity:6,unit:'wardrobe',evidence:'QC'}];
  second.task.approved=4;second.task.status='awaiting_inspection';second.task.inspections=[{id:'qc2',by:'reviewer',at:'now',passed:false,quantity:4,unit:'wardrobe',evidence:'Finish rework'}];
  first.data.dispatches=[{taskId:'task',status:'received',quantity:6,accepted:5,rejected:1,returnedToFactory:1} as Dispatch];
  const a=factoryAllocationView(first.allocation,first.data,true),b=factoryAllocationView(second.allocation,second.data,true);
  expect([a.dispatched,a.received,a.returned,b.received]).toEqual([5,5,1,0]);expect(factoryBatchState(batch,[a,b])).toBe('rework');
  expect(a.snapshot.quantity+b.snapshot.quantity).toBe(10);
 });
 it('retains a cancelled state and flags missing source tasks',()=>{
  const {data,allocation}=fixture();data.tasks=[];
  const view=factoryAllocationView(allocation,data,false);
  expect(factoryBatchState({} as FactoryBatch,[view])).toBe('needs_review');
  expect(factoryBatchState({cancelled:{reason:'regroup'}} as FactoryBatch,[view])).toBe('cancelled');
 });
});
