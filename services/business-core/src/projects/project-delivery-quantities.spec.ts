import {describe,it,expect} from 'vitest';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
import type {DeliveryQuantityRow,ProjectWorkPackage,ReleasedScopeLine,Task} from './execution.types';
import {deliveryQuantityReadiness,sourceBalances} from './project-delivery-quantities';
import {workPackageReadiness} from './project-package-readiness';
const actor:ExecutionActor={id:'pm',name:'PM',manage:true,review:false,buy:false,report:false,released:true,memberIds:['pm'],resourceIds:[],now:'2026-09-22T00:00:00Z'};
const line:ReleasedScopeLine={id:'line',title:'Wardrobes',quantity:10,unit:'nos',room:'Bedroom',material:'Oak',sourceScopeVersion:1};
const work:ProjectWorkPackage={id:'w',title:'Wardrobes',scopeLineIds:['line'],area:'Bedroom',deliveryRoute:'mixed',status:'planning',ownerId:'pm',plannedStart:'2026-10-01',plannedEnd:'2026-10-10',blocker:'',createdAt:actor.now,updatedAt:actor.now};
const fixture=()=>({...emptyProject(),scope:{quotationId:'q',version:1,releasedAt:actor.now,value:1000,lines:[{...line}]} as ReturnType<typeof emptyProject>['scope'],workPackages:[structuredClone(work)]});
const row=(id='six',quantity=6):DeliveryQuantityRow=>({id,title:id,quantity,unit:'nos',basis:'',sources:[{scopeLineId:'line',quantity}]});
const save=(data:ReturnType<typeof fixture>,rows=[row(),row('four',4)],status='confirmed',version=0)=>applyExecution(data,'delivery_quantities',{id:'w',rows,status,version},actor);
describe('delivery quantity action contract',()=>{
 it('splits ten into six plus four, snapshots source evidence and leaves execution/commercial state unchanged',()=>{
  const d=fixture();save(d);const plan=d.workPackages[0].deliveryQuantities!;
  expect(plan).toMatchObject({version:1,status:'confirmed',confirmedBy:'pm',sourceSnapshot:[line]});
  expect(sourceBalances([line],plan.rows)[0].remaining).toBe(0);
  expect(d.workPackages[0].status).toBe('planning');expect(d.scope!.value).toBe(1000);expect(d.orders).toEqual([]);
  expect(d.audit.at(-1)).toMatchObject({action:'delivery_quantities',recordId:'w'});
  expect(deliveryQuantityReadiness(d,d.workPackages[0])).toBeUndefined();
 });
 it('saves partial allocation as draft but blocks release and incomplete confirmation',()=>{
  const d=fixture();save(d,[row()],'draft');
  expect(workPackageReadiness(d,d.workPackages[0]).some(issue=>issue.code==='delivery_quantities')).toBe(true);
  expect(()=>save(d,[row()],'confirmed',1)).toThrow('remaining 4 nos');
  expect(d.workPackages[0].deliveryQuantities!.status).toBe('draft');
 });
 it.each([
  ['over-allocation',[row(),row('five',5)],'exceeds'],
  ['repeated delivery identity',[row(),row('six',4)],'unique'],
  ['zero quantity',[row('zero',0)],'positive'],
  ['NaN',[row('bad',NaN)],'positive'],
  ['infinity',[row('bad',Infinity)],'positive'],
  ['precision',[row('bad',0.0000001)],'six decimal'],
  ['foreign source',[{...row(),sources:[{scopeLineId:'other',quantity:6}]}],'belonging'],
  ['repeated source',[{...row(),sources:[{scopeLineId:'line',quantity:3},{scopeLineId:'line',quantity:3}]}],'distinct'],
  ['unexplained conversion',[{...row('units',10),unit:'sets'}],'measurement basis'],
 ] as const)('rejects %s without mutation',(_name,rows,message)=>{
  const d=fixture(),before=structuredClone(d);expect(()=>save(d,structuredClone(rows) as DeliveryQuantityRow[])).toThrow(message);expect(d).toEqual(before);
 });
 it('records a lot-to-units basis without adding unlike quantities',()=>{
  const d=fixture();d.scope!.lines[0]={...line,quantity:1,unit:'lot'};
  save(d,[{...row('wardrobes',10),sources:[{scopeLineId:'line',quantity:1}],basis:'One lot includes ten wardrobes.'}]);
  expect(d.workPackages[0].deliveryQuantities!.rows[0].quantity).toBe(10);
 });
 it('reconciles each source separately in a bundled delivery',()=>{
  const d=fixture();d.scope!.lines.push({...line,id:'panels',title:'Panels',quantity:20,unit:'sqft'});d.workPackages[0].scopeLineIds.push('panels');
  save(d,[{...row('bundle',10),sources:[{scopeLineId:'line',quantity:10},{scopeLineId:'panels',quantity:20}],basis:'Ten wardrobes including 20 sqft of panels.'}]);
  expect(sourceBalances(d.scope!.lines,d.workPackages[0].deliveryQuantities!.rows).map(line=>line.remaining)).toEqual([0,0]);
 });
 it('does not accept stale versions, unauthorized actors or direct edits to a confirmation',()=>{
  const d=fixture();expect(()=>applyExecution(d,'delivery_quantities',{id:'w',version:0,status:'draft',rows:[]},{...actor,manage:false})).toThrow('planner');
  save(d);expect(()=>save(d,undefined,'draft',0)).toThrow('changed');expect(()=>save(d,undefined,'draft',1)).toThrow('Revise confirmed');
 });
 it('archives confirmation and reason on revision without losing source evidence',()=>{
  const d=fixture();save(d);
  expect(()=>applyExecution(d,'revise_delivery_quantities',{id:'w',version:1,reason:''},actor)).toThrow('why');
  applyExecution(d,'revise_delivery_quantities',{id:'w',version:1,reason:'Two phased deliveries'},actor);
  expect(d.audit.at(-1)?.note).toBe('Two phased deliveries');
  expect(d.workPackages[0].deliveryQuantities).toMatchObject({status:'draft',version:2,revisionReason:'Two phased deliveries'});
  expect(d.workPackages[0].deliveryQuantityHistory![0]).toMatchObject({status:'confirmed',version:1,sourceSnapshot:[line]});
  save(d,[row('seven',7),row('three',3)],'confirmed',2);
  expect(d.workPackages[0].deliveryQuantityHistory![0].rows[0].quantity).toBe(6);
 });
 it('detects a changed source revision and a deducted source',()=>{
  const d=fixture();save(d);d.scope!.lines[0].sourceScopeVersion=2;
  expect(deliveryQuantityReadiness(d,d.workPackages[0])).toContain('BOQ changed');
  d.scope!.lines=[];expect(deliveryQuantityReadiness(d,d.workPackages[0])).toContain('BOQ changed');
 });
 it('blocks revision after recorded output even when task is blocked',()=>{
  const d=fixture();save(d);d.tasks.push({id:'task',packageId:'w',status:'blocked',approved:1} as Task);
  const before=structuredClone(d);expect(()=>applyExecution(d,'revise_delivery_quantities',{id:'w',version:1,reason:'Change'},actor)).toThrow('commitments');expect(d).toEqual(before);
 });
 it('rechecks quantities when starting an already-ready package',()=>{
  const d=fixture();save(d,[row()],'draft');d.workPackages[0].status='ready';
  d.tasks.push({id:'task',packageId:'w',status:'planned',approved:0,quantity:10,weight:1,predecessors:[],scopeIds:['line'],ownerId:'pm',location:'office',readiness:{scope:true,access:true,materials:true}} as unknown as Task);
  expect(()=>applyExecution(d,'task_status',{id:'task',status:'in_progress'},actor)).toThrow('Confirm delivery quantities');
 });
 it('leaves legacy items compatible without inventing quantities',()=>{
  const d=fixture();expect(deliveryQuantityReadiness(d,d.workPackages[0])).toBeUndefined();expect(d.workPackages[0].deliveryQuantities).toBeUndefined();
 });
});
