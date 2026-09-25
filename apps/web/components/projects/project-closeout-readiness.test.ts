import {describe,it,expect} from 'vitest';
import {closeoutScopeRows} from './project-closeout-readiness';
import type {ProjectState} from '@/lib/projects/execution';
const state=(tasks:unknown[],snags:unknown[]=[])=>({data:{scope:{lines:[{id:'boq',title:'Wardrobe',room:'Bedroom'}]},tasks,snags}} as unknown as ProjectState);
describe('BOQ completion checks',()=>{
 it('does not consider an unplanned scope item complete',()=>expect(closeoutScopeRows(state([]))[0].status).toBe('Not planned'));
 it('keeps inspections visible before completion',()=>expect(closeoutScopeRows(state([{id:'task',scopeIds:['boq'],status:'awaiting_inspection'}]))[0].status).toBe('Inspection needed'));
 it('keeps unresolved snags visible after work completes',()=>expect(closeoutScopeRows(state([{id:'task',scopeIds:['boq'],status:'completed'}],[{taskId:'task',status:'ready'}]))[0].status).toBe('Snags open'));
});
