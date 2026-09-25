import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {ProjectState} from '@/lib/projects/execution';
import {ProjectFactoryCapacity} from './project-factory-capacity';
const state={id:'project',workspaceId:'workspace',today:'2026-09-22',canManage:true,bookings:[],data:{tasks:[]}} as unknown as ProjectState;
afterEach(()=>vi.unstubAllGlobals());
describe('factory capacity',()=>{
 it('shows server capacity across projects rather than inferring it from project bookings',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({range:{from:state.today,to:state.today},resources:[{id:'factory',name:'Workshop',kind:'factory',timezone:'Asia/Kolkata'}],availability:[{resourceId:'factory',segments:[{date:state.today,startTime:'09:00',endTime:'17:00',capacity:10,confirmed:7,tentative:2,remaining:3,overCapacity:false}]}]})}));
  render(<ProjectFactoryCapacity state={state} onBook={vi.fn()}/>);
  expect(await screen.findByText('Workshop')).toBeTruthy();
  expect(screen.getByText('7')).toBeTruthy();expect(screen.getByText('3')).toBeTruthy();
 });
 it('shows failure without fabricating availability and permits retry',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new Error('Capacity unavailable')).mockResolvedValue({ok:true,json:async()=>({range:{from:state.today,to:state.today},resources:[],availability:[]})});vi.stubGlobal('fetch',fetch);
  render(<ProjectFactoryCapacity state={state} onBook={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Capacity unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Check capacity'}));
  expect(await screen.findByText('No working shifts')).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2);
 });
});
