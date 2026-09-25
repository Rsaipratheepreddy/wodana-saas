import {render,screen,within} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import {ProjectHandoverScope,ProjectInspectionHistory} from './project-handover-scope';
import type {Handover,ProjectState,Task} from '@/lib/projects/execution';
describe('reviewed handover scope',()=>{
 it('shows frozen quantities and document revisions rather than revised live task values',()=>{
  const state={data:{tasks:[{id:'t',title:'Changed title',quantity:99}]}} as ProjectState;
  const handover={taskIds:['t'],packet:{version:2,tasks:[{id:'t',title:'Install chairs',area:'Room',quantity:4,unit:'chair'}],documents:[{id:'doc',title:'Care guide',revision:'R1',kind:'manual'}]}} as Handover;
  render(<ProjectHandoverScope handover={handover} state={state}/>);
  expect(screen.getByText('Reviewed pack · Version 2')).toBeTruthy();
  expect(within(screen.getByRole('table',{name:'Handover scope'})).getByText('4')).toBeTruthy();
  expect(screen.queryByText('Changed title')).toBeNull();expect(screen.getByText('R1')).toBeTruthy();
 });
 it('labels an unprepared scope and displays inspection evidence with reviewer',()=>{
  const state={members:[{id:'qc',name:'Maya'}],data:{tasks:[]}} as unknown as ProjectState;
  render(<><ProjectHandoverScope state={state} handover={{taskIds:[]} as unknown as Handover}/><ProjectInspectionHistory state={state} task={{inspections:[{id:'i',by:'qc',at:'2026-09-22',passed:true,quantity:4,unit:'chair',evidence:'QC-4'}]} as Task}/></>);
  expect(screen.getByText('Scope preview · Not prepared')).toBeTruthy();expect(screen.getByText('Maya')).toBeTruthy();expect(screen.getByText('QC-4')).toBeTruthy();
 });
});
