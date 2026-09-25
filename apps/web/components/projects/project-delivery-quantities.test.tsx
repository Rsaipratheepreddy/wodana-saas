import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectDeliveryQuantities} from './project-delivery-quantities';
import {ProjectWorkPlanEditor} from './project-work-plan-editor';
import type {ProjectState,ProjectWorkPackage} from '@/lib/projects/execution';
const work={id:'w',title:'Wardrobes',area:'Bedroom',status:'planning',scopeLineIds:['line'],deliveryRoute:'mixed',ownerId:'',plannedStart:'',plannedEnd:''} as ProjectWorkPackage;
const state={canManage:true,members:[{id:'pm',name:'Maya'}],data:{scope:{lines:[{id:'line',title:'Wardrobes',quantity:10,unit:'nos'}]},tasks:[],materials:[],orders:[],reports:[],documents:[]}} as unknown as ProjectState;
const setup=(item=work,run=vi.fn().mockResolvedValue(true),close=vi.fn(),project=state)=>{render(<ProjectDeliveryQuantities state={project} work={item} run={run} onClose={close} busy={false} error=""/>);return {run,close};};
describe('delivery quantity editor',()=>{
 it('records six plus four using the existing item command and does not release work',async()=>{
  const {run,close}=setup();
  fireEvent.click(screen.getByRole('button',{name:'Add delivery'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Delivery name'}),{target:{value:'First six'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Delivery quantity'}),{target:{value:'6'}});
  fireEvent.blur(screen.getByRole('textbox',{name:'Delivery quantity'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Allocate Wardrobes (nos)'}),{target:{value:'6'}});
  fireEvent.blur(screen.getByRole('textbox',{name:'Allocate Wardrobes (nos)'}));
  fireEvent.click(screen.getByRole('button',{name:'Apply delivery'}));
  expect(screen.getByText(/6 \/ 10 nos allocated · 4 remaining/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirm quantities'}));
  expect(screen.getByRole('alert')).toHaveTextContent('remaining 4 nos');expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Add delivery'}));
  fireEvent.click(screen.getByRole('button',{name:'Apply delivery'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirm quantities'}));
  await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(run).toHaveBeenCalledWith('delivery_quantities',expect.objectContaining({id:'w',version:0,status:'confirmed',rows:[expect.objectContaining({quantity:6}),expect.objectContaining({quantity:4})]}));
 });
 it('keeps failed saves and asks before discarding entered rows',async()=>{
  const {run,close}=setup(work,vi.fn().mockResolvedValue(false));
  fireEvent.click(screen.getByRole('button',{name:'Add delivery'}));fireEvent.click(screen.getByRole('button',{name:'Apply delivery'}));
  fireEvent.click(screen.getByRole('button',{name:'Save quantities draft'}));await waitFor(()=>expect(run).toHaveBeenCalled());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Back to item'}));expect(screen.getByRole('dialog',{name:'Discard unsaved quantities?'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(screen.getByText('10 nos')).toBeVisible();
 });
 it('requires a reason to revise a confirmed snapshot',async()=>{
  const {run}=setup({...work,deliveryQuantities:{version:3,status:'confirmed',rows:[],updatedBy:'pm',updatedAt:'2026-09-22',confirmedBy:'pm',confirmedAt:'2026-09-22'}});
  expect(screen.queryByRole('button',{name:'Add delivery'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Revise quantities'}));expect(run).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox',{name:'Reason for revision'}),{target:{value:'Change delivery grouping'}});
  fireEvent.click(screen.getByRole('button',{name:'Revise quantities'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('revise_delivery_quantities',{id:'w',version:3,reason:'Change delivery grouping'}));
 });
 it('does not allow a read-only user to change quantities',()=>{
  setup(work,vi.fn(),vi.fn(),{...state,canManage:false});
  expect(screen.getByRole('button',{name:'Add delivery'})).toBeDisabled();expect(screen.getByRole('button',{name:'Confirm quantities'})).toBeDisabled();
 });
 it('opens from the item and returns without losing classification edits',async()=>{
  render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={vi.fn()} onClose={vi.fn()} onOpenTask={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:/How will we supply this/}));fireEvent.click(await screen.findByRole('option',{name:'Buy finished'}));
  fireEvent.click(screen.getByRole('button',{name:'Delivery quantities'}));
  expect(screen.getByRole('dialog',{name:'Delivery quantities · Wardrobes'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Back to item'}));
  expect(screen.getByRole('button',{name:/How will we supply this/})).toHaveTextContent('Buy finished');
 });
});
