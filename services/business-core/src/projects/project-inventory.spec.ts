import {applyControls} from './execution-controls';
import {describe,it,expect} from 'vitest';
import {emptyProject,applyExecution,type ExecutionActor} from './execution.domain';
import {materialInventory,orderReceivingPosition,projectInventory} from './project-inventory';
import type {Material,Order,Task} from './execution.types';
import type {Dispatch} from './execution-controls.types';
import type {StockTransfer} from './project-stock.types';
const material=()=>({id:'boards',required:10,unit:'sheet',movements:[],reservations:[]} as unknown as Material);
const move=(kind:Material['movements'][number]['kind'],quantity:number)=>({kind,quantity,id:kind,at:'now',reference:'evidence'});
const actor={id:'manager',name:'Manager',manage:true,review:true,buy:true,report:true,released:true,now:'2026-09-20T10:00:00Z',memberIds:['manager'],resourceIds:[]} as ExecutionActor;
describe('connected inventory',()=>{
 it('keeps approved supply, pending approvals and accepted stock separate',()=>{
  const m=material();m.movements=[move('receive',3)];
  const orders=[{id:'po',materialId:m.id,quantity:5,status:'approved',receipts:[{accepted:3,rejected:1}]},{id:'review',materialId:m.id,quantity:2,status:'submitted',receipts:[]},{id:'draft',materialId:m.id,quantity:10,status:'draft',receipts:[]}] as Order[];
  expect(materialInventory(m,orders)).toMatchObject({onHand:3,available:3,incoming:2,pendingApproval:2,shortfall:3});
 });
 it('does not reorder issued material and restores unused returns without double receipt',()=>{
  const m=material();m.movements=[move('receive',10),move('issue',7),move('return',2)];m.reservations=[{taskId:'a',quantity:3,at:'now',reference:'booking'}];
  expect(materialInventory(m)).toMatchObject({received:10,onHand:5,reserved:3,available:2,issued:5,covered:10,shortfall:0});
  m.movements.push(move('waste',1),move('supplier_return',1));expect(materialInventory(m)).toMatchObject({onHand:3,available:0,shortfall:2});
 });
 it('includes approved transfers once and replaces incoming with stock at receipt',()=>{
  const m=material();const transfer={id:'t',destination:{kind:'project',id:'p',materialId:m.id},quantity:4,status:'approved'} as StockTransfer;
  expect(materialInventory(m,[],[transfer])).toMatchObject({available:0,incoming:4,shortfall:6});
  transfer.status='received';transfer.accepted=3;transfer.rejected=1;m.movements=[move('receive',3)];
  expect(materialInventory(m,[],[transfer])).toMatchObject({available:3,incoming:0,shortfall:7});
 });
 it('reopens only the returned quantity on an acknowledged order',()=>{
  const m=material();m.movements=[move('receive',10),move('supplier_return',2)];
  const po={id:'po',materialId:m.id,quantity:10,status:'acknowledged',receipts:[{accepted:10,rejected:0}]} as Order;
  const returns=[{id:'return',orderId:po.id,quantity:2,status:'credited'}] as NonNullable<ReturnType<typeof emptyProject>['supplierReturns']>;
  expect(materialInventory(m,[po],[],returns)).toMatchObject({covered:8,incoming:2,shortfall:0});
 });
 it('separates accepted, pending inspection and still-to-arrive quantities',()=>{
  const po={id:'po',quantity:10,receipts:[{accepted:4,pending:6,rejected:0}]} as Order;
  expect(orderReceivingPosition({},po)).toEqual({accepted:4,pendingInspection:6,remainingToArrive:0});
  const returns=[{id:'return',orderId:'po',quantity:2,status:'credited'}] as NonNullable<ReturnType<typeof emptyProject>['supplierReturns']>;
  expect(orderReceivingPosition({supplierReturns:returns},po)).toEqual({accepted:2,pendingInspection:6,remainingToArrive:2});
 });
 it('keeps raw material issues independent from finished output and site receipt',()=>{
  const d=emptyProject();const m=material();m.movements=[move('receive',10),move('issue',4)];d.materials=[m];
  d.tasks=[{id:'build',title:'Wardrobes',location:'factory',quantity:5,approved:3,unit:'nos',status:'in_progress'} as Task];
  d.dispatches=[{id:'delivery',taskId:'build',quantity:2,status:'dispatched',accepted:0,rejected:0} as Dispatch];
  expect(projectInventory(d).materials[0]).toMatchObject({onHand:6,issued:4});
  expect(projectInventory(d).factory[0]).toMatchObject({onHand:1,available:1,inTransit:2,accepted:0,remainingToBuild:2});
  d.dispatches[0]={...d.dispatches[0],status:'received',accepted:1,rejected:1};
  expect(projectInventory(d).factory[0]).toMatchObject({available:1,inTransit:0,accepted:1,rejected:1});
 });
 it('does not release rejected factory output until both return and correction are recorded',()=>{
  const d=emptyProject();d.phase='active';d.tasks=[{id:'build',location:'factory',quantity:2,approved:2,unit:'nos',status:'completed'} as Task];
  d.dispatches=[{id:'delivery',taskId:'build',quantity:2,status:'received',accepted:0,rejected:2,rejectionSnagId:'defect'} as Dispatch];
  d.snags=[{id:'defect',status:'closed'} as never];
  expect(projectInventory(d).factory[0].available).toBe(0);
  expect(()=>applyControls(d,'dispatch_return',{id:'delivery',quantity:3,evidence:'Factory receipt'},actor)).toThrow(/rejected quantity/);
  applyControls(d,'dispatch_return',{id:'delivery',quantity:1,evidence:'Factory receipt'},actor);
  expect(projectInventory(d).factory[0]).toMatchObject({available:1,rejected:1});
  expect(()=>applyControls(d,'dispatch_return',{id:'delivery',quantity:1,evidence:'Replay'},actor)).toThrow(/total returned/);
  d.snags[0].status='open';expect(projectInventory(d).factory[0].available).toBe(0);
 });
 it('reserves only approved dispatches and never creates stock from a draft',()=>{
  const d=emptyProject();d.tasks=[{id:'f',location:'factory',quantity:4,approved:4} as Task];d.dispatches=[{id:'d',taskId:'f',status:'draft',quantity:3} as Dispatch];
  expect(projectInventory(d).factory[0].available).toBe(4);d.dispatches[0].status='ready';expect(projectInventory(d).factory[0]).toMatchObject({available:1,reserved:3});
 });
});
