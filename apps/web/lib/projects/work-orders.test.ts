import {describe,it,expect} from 'vitest';
import {workOrderDetails} from './work-orders';
import type {ProjectState,ProjectWorkPackage} from './execution';
const work={id:'w',scopeLineIds:['line'],title:'Cabinet',status:'planning'} as ProjectWorkPackage;
const state={data:{tasks:[],materials:[],orders:[],documents:[]}} as unknown as ProjectState;
describe('work order projection',()=>{
 it('never calls unplanned quotation scope executable',()=>{
  expect(workOrderDetails(state,work)).toMatchObject({stage:'Needs planning',next:'Choose supply and site work'});
 });
 it('links requirements through scope even before a task is assigned and excludes other orders',()=>{
  const data={...state.data,materials:[{id:'m',scopeLineId:'line',taskId:'',supply:'company',required:4,movements:[]}],orders:[{id:'o',materialId:'m',status:'draft'},{id:'other',materialId:'other',status:'draft'}]};
  const detail=workOrderDetails({...state,data} as unknown as ProjectState,work);
  expect(detail.materials.map(m=>m.id)).toEqual(['m']);
  expect(detail.orders.map(o=>o.id)).toEqual(['o']);
 });
 it('preserves actual execution status for legacy work orders',()=>{
  expect(workOrderDetails(state,{...work,status:'in_progress'})).toMatchObject({stage:'In progress',next:'Update progress'});
 });
 it('shows actual running tasks even while the work order plan is incomplete',()=>{
  const running={...state,data:{...state.data,tasks:[{id:'t',packageId:'w',status:'in_progress'}]}} as ProjectState;
  expect(workOrderDetails(running,work)).toMatchObject({stage:'In progress',next:'Update progress'});
 });
});
