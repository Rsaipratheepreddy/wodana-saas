import {render,screen,fireEvent,within} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectWorkOrders} from './project-work-orders';
import type {ProjectState,ProjectWorkPackage} from '@/lib/projects/execution';
const work={id:'item',title:'Kitchen cabinets',area:'Kitchen',status:'planning',scopeLineIds:['boq'],ownerId:'person',supplyMethod:'make',siteWork:'install'} as ProjectWorkPackage;
const state={members:[{id:'person',name:'Maya'}],canManage:true,data:{workPackages:[work],tasks:[],materials:[],orders:[],documents:[]},pulse:{nextActions:[]}} as unknown as ProjectState;
describe('item-first project flow',()=>{
 it('labels action priority and preserves the source task link',()=>{
  const action={id:'late-task',recordId:'task',kind:'recover_task',priority:'critical',title:'Recover delayed installation',detail:'Confirm the recovery date.',section:'plan-teams'};
  render(<ProjectWorkOrders state={{...state,id:'project',pulse:{...state.pulse,nextActions:[action as never]}}} onOpen={vi.fn()}/>);
  const actionLink=screen.getByRole('link',{name:/Urgent Recover delayed installation/});
  expect(actionLink).toHaveAttribute('data-priority','critical');
  expect(actionLink.getAttribute('href')).toContain('record=task');
 });
 it('connects the actions menu to the existing planning and delivery stages',()=>{
  const open=vi.fn();render(<ProjectWorkOrders state={state} onOpen={open}/>);
  fireEvent.click(screen.getByRole('button',{name:'Actions for Kitchen cabinets'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Materials & procurement'}));expect(open).toHaveBeenLastCalledWith(work,'materials');
  fireEvent.click(screen.getByRole('button',{name:'Actions for Kitchen cabinets'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Quality & rework'}));expect(open).toHaveBeenLastCalledWith(work,'quality');
 });
 it('opens the next action and filters without mutating item status',()=>{
  const open=vi.fn();render(<ProjectWorkOrders state={state} onOpen={open}/>);
  const item=within(screen.getByRole('table',{name:'Project items'}));
  fireEvent.click(item.getByRole('button',{name:'Add tasks'}));expect(open).toHaveBeenLastCalledWith(work,'steps');
  expect(screen.queryByRole('group',{name:'Filter items by pipeline stage'})).not.toBeInTheDocument();
  expect(work.status).toBe('planning');
 });
 it('shows planning before inventing manufacturing or material readiness',()=>{
  const unplanned={...work,supplyMethod:undefined,siteWork:undefined};
  render(<ProjectWorkOrders state={{...state,data:{...state.data,workPackages:[unplanned]}}} onOpen={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Plan item'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Factory/})).not.toBeInTheDocument();
  expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  expect(screen.queryByText('Choose supply, owner and dates')).not.toBeInTheDocument();
  expect(screen.queryByText('Supply not planned')).not.toBeInTheDocument();
  expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
 });
 it('filters actual items without duplicating package alerts',()=>{
  render(<ProjectWorkOrders state={{...state,pulse:{...state.pulse,nextActions:[{id:'alert',recordId:'item',kind:'prepare_work',title:'Prepare cabinets'} as never]}}} onOpen={vi.fn()}/>);
  expect(screen.queryByText('Prepare cabinets')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox',{name:'Search items'}),{target:{value:'wardrobe'}});
  expect(screen.queryByRole('button',{name:'Kitchen cabinets'})).not.toBeInTheDocument();
  expect(screen.getByText('No matching items')).toBeInTheDocument();
 });
});

it('keeps a package visible when a server pipeline entry is missing',()=>{
 const open=vi.fn();
 render(<ProjectWorkOrders state={{...state,itemPipeline:[]}} onOpen={open}/>);
 expect(screen.getByRole('button',{name:'Kitchen cabinets'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Review item'}));
 expect(open).toHaveBeenCalledWith(work,'plan');
 expect(screen.getByText('Not scheduled')).toBeVisible();
});
it('filters attention and accepted items using the server read model',async()=>{
 const other={...work,id:'accepted',title:'Wardrobe'};
 const pipeline=[{id:work.id,stage:'source',next:'Source materials',target:'materials',blocked:'Awaiting approval',overdue:false,completedTasks:0,totalTasks:1,materials:[]},{id:other.id,stage:'done',next:'View acceptance',target:'complete',blocked:'',overdue:false,completedTasks:1,totalTasks:1,materials:[]}] as ProjectState['itemPipeline'];
 render(<ProjectWorkOrders state={{...state,data:{...state.data,workPackages:[work,other]},itemPipeline:pipeline}} onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:/Table view/}));
 fireEvent.click(await screen.findByRole('option',{name:'Needs attention'}));
 expect(screen.getByRole('button',{name:'Kitchen cabinets'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Wardrobe'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Table view/}));
 fireEvent.click(await screen.findByRole('option',{name:'Accepted'}));
 expect(screen.getByRole('button',{name:'Wardrobe'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Kitchen cabinets'})).not.toBeInTheDocument();
});
it('opens a read-only item without advertising an operational action',()=>{
 const open=vi.fn();
 render(<ProjectWorkOrders state={{...state,canManage:false,canBuy:false,canReport:false}} onOpen={open}/>);
 expect(screen.queryByRole('button',{name:'Add tasks'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'View item'}));
 expect(open).toHaveBeenCalledWith(work,'steps');
});
it('distinguishes on-site subcontract work from an unreviewed legacy location',()=>{
 const painting={...work,id:'painting',title:'Painting',supplyMethod:'subcontract' as const,workLocation:'site' as const,siteWork:'site_work' as const};
 render(<ProjectWorkOrders state={{...state,data:{...state.data,workPackages:[work,painting]}}} onOpen={vi.fn()}/>);
 expect(screen.getByText('Subcontract · On-site · Site work')).toBeVisible();
 expect(screen.getByText('Make ourselves · Review location · Installation')).toBeVisible();
});
