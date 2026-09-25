import {describe,it,expect} from 'vitest';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
import {applyControls} from './execution-controls';
import {factoryQcQuantity,projectInventory} from './project-inventory';
import type {Task} from './execution.types';
const actor:ExecutionActor={id:'maker',name:'Maker',manage:true,review:true,buy:true,report:true,released:true,memberIds:['maker','reviewer'],resourceIds:[],now:'2026-09-22T10:00:00Z'};
const reviewer={...actor,id:'reviewer',name:'Reviewer'};
function setup(){
 const data=emptyProject();data.phase='active';
 const task:Task={id:'factory',title:'Wardrobes',package:'Joinery',area:'Bedroom',description:'',location:'factory',status:'in_progress',quantity:4,approved:2,unit:'nos',ownerId:'maker',assigneeIds:[],parentId:'',resourceId:'',start:'2026-09-22',end:'2026-09-23',baselineStart:'2026-09-22',baselineEnd:'2026-09-23',predecessors:[],weight:1,priority:'normal',inspectionRequired:true,scopeIds:[],drawingId:'',readiness:{scope:true,materials:true,access:true},blocker:''};
 data.tasks=[task,{...task,id:'site',location:'site',status:'planned',approved:0,predecessors:['factory']}];
 data.reports=[{id:'output',date:'2026-09-22',shift:'Day',location:'factory',authorId:'maker',author:'Maker',status:'approved',entries:[{taskId:'factory',quantity:2}],hours:4,people:1,materials:'',issues:'',tomorrow:'',evidence:'Output record',note:''}];
 return {data,task};
}
describe('production lot QC and dispatch',()=>{
 it('limits lots to independently approved output and rejects self review',()=>{
  const {data,task}=setup();
  expect(()=>applyExecution(data,'factory_lot',{id:task.id,title:'Too many',quantity:3},actor)).toThrow(/approved factory output/);
  applyExecution(data,'factory_lot',{id:task.id,title:'First pair',quantity:2},actor);
  const batchId=task.factoryLots![0].id;
  expect(()=>applyExecution(data,'factory_lot_review',{id:task.id,batchId,passed:true,note:'Self QC'},actor)).toThrow(/Another reviewer/);
  expect(factoryQcQuantity(task)).toBe(0);
  applyExecution(data,'factory_lot_review',{id:task.id,batchId,passed:false,note:'Edge banding correction'},reviewer);
  expect(task.factoryLots![0].status).toBe('rework');
  applyExecution(data,'factory_lot_review',{id:task.id,batchId,passed:true,note:'Corrected edges inspected'},reviewer);
  expect(task.factoryLots![0].reviews).toHaveLength(2);
  expect(task.status).toBe('in_progress');
  expect(projectInventory(data).factory[0].available).toBe(2);
  expect(()=>applyExecution(data,'factory_lot_cancel',{id:task.id,batchId,note:'Cannot erase QC'},actor)).toThrow(/current production lot/);
  expect(()=>applyExecution(data,'inspect',{id:task.id,passed:true,note:'Bypass'},reviewer)).toThrow(/production lots individually/);
 });
 it('requires a passed lot and conserves its quantity across dispatch reservations',()=>{
  const {data,task}=setup();
  applyExecution(data,'factory_lot',{id:task.id,title:'First pair',quantity:2},actor);
  const factoryLotId=task.factoryLots![0].id;
  const dispatch=(id:string,quantity:number,lotId=factoryLotId)=>applyControls(data,'dispatch',{record:{id,title:id,taskId:task.id,receivingTaskId:'site',factoryLotId:lotId,quantity,destination:'Site',dueDate:'2026-09-23'}},actor);
  dispatch('first',1);
  expect(()=>applyControls(data,'dispatch_status',{id:'first',status:'ready',note:'Partial delivery'},reviewer)).toThrow(/passed production lot/);
  applyExecution(data,'factory_lot_review',{id:task.id,batchId:factoryLotId,passed:true,note:'QC passed'},reviewer);
  applyControls(data,'dispatch_status',{id:'first',status:'ready',note:'Partial delivery'},reviewer);
  dispatch('too-many',2);
  expect(()=>applyControls(data,'dispatch_status',{id:'too-many',status:'ready',note:'Second delivery'},reviewer)).toThrow(/remaining passed production lot/);
  dispatch('wrong-lot',1,'outside');
  expect(()=>applyControls(data,'dispatch_status',{id:'wrong-lot',status:'ready',note:'Second delivery'},reviewer)).toThrow(/passed production lot/);
  expect(projectInventory(data).factory[0]).toMatchObject({available:1,reserved:1});
 });
 it('keeps uninspected output out of finished stock and prevents correction below allocated lots',()=>{
  const {data,task}=setup();expect(projectInventory(data).factory[0].available).toBe(0);
  applyExecution(data,'factory_lot',{id:task.id,title:'First pair',quantity:2},actor);
  applyExecution(data,'report_submit',{report:{...data.reports[0],id:'correction',supersedes:'output',entries:[{taskId:task.id,quantity:1}]}},actor);
  expect(()=>applyExecution(data,'approve_report',{id:'correction'},reviewer)).toThrow(/reducing installed output/);
  expect(data.reports.find(report=>report.id==='correction')?.status).toBe('submitted');
 });
});
