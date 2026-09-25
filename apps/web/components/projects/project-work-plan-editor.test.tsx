import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectWorkPlanEditor } from './project-work-plan-editor';
import type { ProjectState, ProjectWorkPackage } from '@/lib/projects/execution';
const work = { id:'w', title:'Kitchen', area:'Kitchen', deliveryRoute:'mixed', status:'planning', ownerId:'', plannedStart:'2026-10-01', plannedEnd:'2026-10-10', scopeLineIds:['line'], risk:'watch', recoveryPlan:'Keep existing', predecessorPackageIds:['other'] } as ProjectWorkPackage;
const state = { id:'p', canManage:true, members:[], data:{tasks:[],materials:[],orders:[],documents:[],scope:{lines:[{id:'line',title:'Kitchen',quantity:1,unit:'nos'}]}} } as unknown as ProjectState;
describe('delivery planning editor',()=>{
  it('connects task material actions and includes partial batch QC and handover',()=>{
    const task={id:'t',packageId:'w',title:'Install',location:'site',status:'in_progress',quantity:10,approved:4,unit:'nos',predecessors:[],start:'2026-10-01',end:'2026-10-10',installationBatches:[{id:'pending',status:'pending_qc',quantity:2},{id:'passed',status:'passed',quantity:2}]};
    const fixture={...state,data:{...state.data,tasks:[task],handovers:[]}} as unknown as ProjectState;
    const open=vi.fn(),handover=vi.fn();
    const props={state:fixture,work,busy:false,error:'',run:vi.fn(),onClose:vi.fn(),onOpenTask:open,onHandover:handover};
    const {unmount}=render(<ProjectWorkPlanEditor {...props} initialTab="steps"/>);
    fireEvent.click(screen.getByRole('button',{name:'Task actions for Install'}));fireEvent.click(screen.getByRole('menuitem',{name:'Materials & stock'}));expect(open).toHaveBeenCalledWith(task,'steps','materials');unmount();
    const quality=render(<ProjectWorkPlanEditor {...props} initialTab="quality"/>);fireEvent.click(screen.getByRole('button',{name:'Inspect work'}));expect(open).toHaveBeenLastCalledWith(task,'quality');quality.unmount();
    render(<ProjectWorkPlanEditor {...props} initialTab="complete"/>);fireEvent.click(screen.getByRole('button',{name:'Prepare partial handover'}));expect(handover).toHaveBeenCalled();
  });
  it('preserves operational fields and status when saving the focused plan',async()=>{
    const run=vi.fn().mockResolvedValue(true), close=vi.fn();
    render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={run} onClose={close} onOpenTask={()=>{}}/>);
    expect(screen.queryByLabelText('Risk')).not.toBeInTheDocument();
    expect(screen.queryByRole('list',{name:'Item pipeline'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Responsible person/})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Check.*ready/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/How will we supply this/}));
    fireEvent.click(await screen.findByRole('option',{name:'Buy finished'}));
    fireEvent.click(screen.getByRole('button',{name:/What happens on-site/}));
    fireEvent.click(await screen.findByRole('option',{name:'Installation'}));
    fireEvent.click(screen.getByRole('button',{name:'Save & continue'}));
    await waitFor(()=>expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith('work_package',{workPackage:{...work,supplyMethod:'buy',siteWork:'install',workLocation:''}});
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Plan work'})).toBeInTheDocument());
  });
  it('creates a linked planned operation without claiming readiness',async()=>{
    const run=vi.fn().mockResolvedValue(true);
    render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={run} onClose={()=>{}} onOpenTask={()=>{}} initialTab="steps"/>);
    fireEvent.click(screen.getByRole('button',{name:'+ Add task'}));
    fireEvent.change(screen.getByLabelText('Task name'),{target:{value:'Install cabinets'}});
    fireEvent.click(screen.getByRole('button',{name:'Add task'}));
    await waitFor(()=>expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][1].task).toMatchObject({title:'Install cabinets',packageId:'w',scopeIds:['line'],location:'site',readiness:{scope:false,access:false,materials:false}});
  });
  it('saves a requirement against the selected task and BOQ item',async()=>{
    const run=vi.fn().mockResolvedValue(true);
    const fixture={...state,data:{...state.data,tasks:[{id:'task',packageId:'w',title:'Fabricate',status:'planned',location:'factory',predecessors:[],readiness:{scope:false,access:false,materials:false},start:'2026-10-01',end:'2026-10-10'}]}} as unknown as ProjectState;
    render(<ProjectWorkPlanEditor state={fixture} work={work} busy={false} error="" run={run} onClose={()=>{}} onOpenTask={()=>{}} initialTab="materials"/>);
    fireEvent.click(screen.getByRole('button',{name:'+ Add requirement'}));
    fireEvent.change(screen.getByLabelText('Requirement'),{target:{value:'Oak boards'}});
    fireEvent.click(screen.getByRole('button',{name:'Save requirement'}));
    await waitFor(()=>expect(run).toHaveBeenCalledWith('material',{material:expect.objectContaining({title:'Oak boards',taskId:'task',scopeLineId:'line',supply:'company',required:1})}));
  });

  it('opens readiness tasks in place without redirecting to Purchasing',()=>{
    const open=vi.fn();
    const task={id:'task',packageId:'w',title:'Fabricate',status:'planned',location:'factory',ownerId:'m',drawingId:'old',predecessors:[],readiness:{scope:true,access:false,materials:false},start:'2026-10-01',end:'2026-10-10'};
    const fixture={...state,data:{...state.data,tasks:[task],documents:[{id:'old',status:'review'}]}} as unknown as ProjectState;
    render(<ProjectWorkPlanEditor state={fixture} work={work} busy={false} error="" run={vi.fn()} onClose={()=>{}} onOpenTask={open} initialTab="checks"/>);
    expect(screen.getByRole('columnheader',{name:'Drawing'})).toBeInTheDocument();
    expect(screen.getAllByLabelText('Pending')).toHaveLength(3);
    expect(screen.queryByText(/checked again by the server/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    expect(open).toHaveBeenCalledWith(task, "checks");
  });

  it('connects a ready delivery plan to the live factory, site and progress routes',()=>{
    render(<ProjectWorkPlanEditor state={state} work={{...work,status:'ready'}} busy={false} error="" run={vi.fn()} onClose={()=>{}} onOpenTask={()=>{}} initialTab="checks"/>);
    expect(screen.getByRole('link',{name:'Factory tasks →'})).toHaveAttribute('href','/workspace/projects/p/production');
    expect(screen.getByRole('link',{name:'On-site work →'})).toHaveAttribute('href','/workspace/projects/p/site-work');
    expect(screen.getByRole('link',{name:'Daily progress →'})).toHaveAttribute('href','/workspace/projects/p/daily-progress');
    expect(screen.queryByRole('button',{name:'Check & release for work'})).not.toBeInTheDocument();
  });

  it('does not advance an incomplete plan or claim approval',()=>{
    const run=vi.fn();
    render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={run} onClose={()=>{}} onOpenTask={()=>{}} initialTab="steps"/>);
    fireEvent.click(screen.getByRole('button',{name:'Save & continue'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Assign the item owner');
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps handover disabled while work is incomplete',()=>{
    render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={vi.fn()} onClose={()=>{}} onOpenTask={()=>{}} onHandover={()=>{}} initialTab="complete"/>);
    expect(screen.getByRole('button',{name:'Prepare handover'})).toBeDisabled();
    expect(screen.getByText('Work still in progress')).toBeInTheDocument();
  });

});

it('plans on-site subcontract work without suggesting factory fabrication',async()=>{
  const run=vi.fn().mockResolvedValue(true);
  render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={run} onClose={()=>{}} onOpenTask={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:/How will we supply this/}));
  fireEvent.click(await screen.findByRole('option',{name:'Subcontract'}));
  fireEvent.click(screen.getByRole('button',{name:/Where will the work happen/}));
  fireEvent.click(await screen.findByRole('option',{name:'On-site'}));
  fireEvent.click(screen.getByRole('button',{name:/What happens on-site/}));
  fireEvent.click(await screen.findByRole('option',{name:'Site work'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & continue'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Plan work'})).toBeVisible());
  expect(run).toHaveBeenCalledWith('work_package',{workPackage:expect.objectContaining({supplyMethod:'subcontract',workLocation:'site',siteWork:'site_work',status:'planning'})});
  expect(screen.getByRole('button',{name:'+ Carry out Kitchen'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Fabricate/})).not.toBeInTheDocument();
});
it('saves an incomplete draft without requiring owner, tasks or execution release',async()=>{
  const run=vi.fn().mockResolvedValue(true);
  render(<ProjectWorkPlanEditor state={state} work={work} busy={false} error="" run={run} onClose={()=>{}} onOpenTask={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Draft saved'));
  expect(run).toHaveBeenCalledWith('work_package',{workPackage:expect.objectContaining({status:'planning',ownerId:'',workLocation:''})});
  expect(screen.getByRole('heading',{name:'Supply & site plan'})).toBeVisible();
});
it('requires work location before continuing and preserves a failed draft',async()=>{
  const run=vi.fn().mockResolvedValue(false),close=vi.fn();
  const classified={...work,supplyMethod:'make',siteWork:'none'} as ProjectWorkPackage;
  render(<ProjectWorkPlanEditor state={state} work={classified} busy={false} error="" run={run} onClose={close} onOpenTask={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save & continue'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose where');
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Where will the work happen/}));
  fireEvent.click(await screen.findByRole('option',{name:'Our factory'}));
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await waitFor(()=>expect(run).toHaveBeenCalled());
  expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:/Where will the work happen/})).toHaveTextContent('Our factory');
});
it('does not invent task quantity and units for a grouped item',()=>{
  render(<ProjectWorkPlanEditor state={{...state,data:{...state.data,scope:undefined}} as unknown as ProjectState} work={work} busy={false} error="" run={vi.fn()} onClose={()=>{}} onOpenTask={()=>{}} initialTab="steps"/>);
  fireEvent.click(screen.getByRole('button',{name:'+ Add task'}));
  expect(screen.getByLabelText('Quantity')).toHaveValue(null);
  expect(screen.getByLabelText('Unit')).toHaveValue('');
});
