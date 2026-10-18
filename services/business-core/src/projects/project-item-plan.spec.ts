import {describe,it,expect} from 'vitest';
import {itemDeliveryRoute,itemTaskSuggestions} from './project-item-plan';
import {applyExecution,emptyProject,type ExecutionActor} from './execution.domain';
import type {ProjectWorkPackage,Task,Order} from './execution.types';
const actor:ExecutionActor={id:'pm',name:'PM',manage:true,review:true,buy:true,report:true,released:false,memberIds:['pm'],resourceIds:[],now:'2026-09-22T00:00:00Z'};
const work:ProjectWorkPackage={id:'w',title:'Wardrobe',area:'Bedroom',scopeLineIds:['line'],deliveryRoute:'mixed',status:'planning',ownerId:'',plannedStart:'',plannedEnd:'',blocker:'',createdAt:actor.now,updatedAt:actor.now};
const fixture=()=>({...emptyProject(),workPackages:[{...work}]});
describe('item classification contract',()=>{
 it.each([
  ['make','factory','install','mixed','factory'],['subcontract','supplier','install','mixed','factory'],
  ['buy',undefined,'delivery','site','site'],['make','site','install','site','site'],
  ['subcontract','site','site_work','site','site'],['buy',undefined,'install','site','site'],
  ['client',undefined,'install','site','site'],['subcontract','supplier','install','mixed','factory'],
  ['make','office','none','office','office'],
 ] as const)('keeps responsibility and location separate: %s %s %s',(supplyMethod,workLocation,siteWork,route,firstLocation)=>{
  const plan={...work,supplyMethod,workLocation,siteWork};
  expect(itemDeliveryRoute(plan)).toBe(route);
  expect(itemTaskSuggestions(plan)[0].location).toBe(firstLocation);
  const d=fixture();applyExecution(d,'work_package',{workPackage:plan},actor);
  expect(d.workPackages[0]).toMatchObject({supplyMethod,workLocation,deliveryRoute:route,status:'planning'});
 });
 it('does not invent factory tasks for unreviewed legacy subcontract work',()=>{
  expect(itemDeliveryRoute({...work,supplyMethod:'subcontract',siteWork:'none'})).toBe('vendor');
  expect(itemTaskSuggestions({...work,supplyMethod:'subcontract',siteWork:'none'})).toEqual([]);
 });
 it('creates only one site-work suggestion for subcontract painting',()=>{
  expect(itemTaskSuggestions({...work,title:'Paint walls',supplyMethod:'subcontract',workLocation:'site',siteWork:'site_work'})).toEqual([{title:'Carry out Paint walls',location:'site'}]);
 });
 it('rejects inconsistent responsibility/location without changing the plan',()=>{
  const d=fixture();expect(()=>applyExecution(d,'work_package',{workPackage:{...work,supplyMethod:'buy',workLocation:'factory',siteWork:'none'}},actor)).toThrow(/location/);
  expect(d.workPackages[0]).toEqual(work);
 });
 it('retains drafts without requiring release or pretending they are ready',()=>{
  const d=fixture();applyExecution(d,'work_package',{workPackage:{...work,supplyMethod:'',siteWork:'',workLocation:''}},actor);
  expect(d.workPackages[0].status).toBe('planning');
 });
 it('rejects classification changes after a committed order, but allows owner planning',()=>{
  const d=fixture();d.workPackages[0]={...work,supplyMethod:'make',workLocation:'factory',siteWork:'install'};
  d.tasks=[{id:'t',packageId:'w',status:'planned',approved:0,location:'factory',start:'',ownerId:''} as Task];
  d.orders=[{id:'o',taskId:'t',materialId:'',status:'approved',receipts:[]} as Order];
  const before=structuredClone(d.workPackages[0]);
  expect(()=>applyExecution(d,'work_package',{workPackage:{...before,supplyMethod:'subcontract',workLocation:'supplier'}},actor)).toThrow(/commitments/);
  expect(d.workPackages[0]).toEqual(before);
  applyExecution(d,'work_package',{workPackage:{...before,ownerId:'pm'}},actor);
  expect(d.workPackages[0].ownerId).toBe('pm');
 });
 it('protects reported work even if the task is currently blocked',()=>{
  const d=fixture();d.tasks=[{id:'t',packageId:'w',status:'blocked',approved:1} as Task];
  expect(()=>applyExecution(d,'work_package',{workPackage:{...work,supplyMethod:'make',workLocation:'site',siteWork:'site_work'}},actor)).toThrow(/recorded work/);
 });
 it('requires planning authority',()=>{
  expect(()=>applyExecution(fixture(),'work_package',{workPackage:work},{...actor,manage:false})).toThrow(/planner/);
 });
});
