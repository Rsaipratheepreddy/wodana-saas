import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectApprovals} from './project-approvals';
import type {ProjectState,ProjectRfa} from '@/lib/projects/execution';
const document={id:'doc',title:'Wardrobe drawing',kind:'drawing',revision:'R1',url:'https://example.com/drawing.pdf',note:'',status:'draft',replaces:'',published:false,scopeLineIds:['line']};
const request:ProjectRfa={id:'rfa',version:2,documentId:'doc',status:'submitted',reviewerId:'reviewer',dueDate:'2026-10-01',instructions:'Check sizes',createdBy:'pm',createdAt:'2026-09-22',submittedBy:'pm',submittedAt:'2026-09-22',history:[]};
const state={id:'project',memberId:'pm',canManage:true,canReview:false,members:[{id:'pm',name:'Planner'},{id:'reviewer',name:'Reviewer'}],data:{documents:[document],rfas:[]}} as unknown as ProjectState;
describe('project RFA queue',()=>{
 it('opens an explicit approvals table with a primary new-request action',()=>{
  render(<ProjectApprovals state={state} busy={false} error="" run={vi.fn()}/>);
  expect(screen.getByRole('table',{name:'Project approvals'})).toBeVisible();
  expect(screen.getByRole('region',{name:'Project approvals'})).toHaveAttribute('data-grid-lines','true');
  fireEvent.click(screen.getByRole('button',{name:'New RFA'}));expect(screen.getByRole('dialog',{name:'New RFA'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Save draft'})).toBeVisible();
 });
 it('saves a draft against a selected document without submitting automatically',async()=>{
  const run=vi.fn().mockResolvedValue(true);render(<ProjectApprovals state={state} busy={false} error="" run={run}/>);
  fireEvent.click(screen.getByRole('button',{name:'New RFA'}));
  fireEvent.click(screen.getByRole('button',{name:/Document revision/}));fireEvent.click(await screen.findByRole('option',{name:'Wardrobe drawing · R1'}));
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('rfa_save',expect.objectContaining({version:0,documentId:'doc'})));
  expect(run).toHaveBeenCalledTimes(1);
 });
 it('allows only the named reviewer to start review from a deep-linked request',async()=>{
  const run=vi.fn().mockResolvedValue(true);render(<ProjectApprovals state={{...state,memberId:'reviewer',canManage:false,canReview:true,data:{...state.data,rfas:[request]}} as never} initialId="rfa" busy={false} error="" run={run}/>);
  expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Start review'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('rfa_review',expect.objectContaining({id:'rfa',version:2})));
 });
 it('requires a return reason and retains the dialog after a failed decision',async()=>{
  const run=vi.fn().mockResolvedValue(false);render(<ProjectApprovals state={{...state,memberId:'reviewer',canManage:false,canReview:true,data:{...state.data,rfas:[{...request,status:'in_review',version:3}]}} as never} initialId="rfa" busy={false} error="" run={run}/>);
  fireEvent.click(screen.getByRole('button',{name:'Return for revision'}));expect(run).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
  fireEvent.change(screen.getByRole('textbox',{name:'Decision / revision reason'}),{target:{value:'Revise dimensions'}});
  fireEvent.click(screen.getByRole('button',{name:'Return for revision'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('rfa_decide',expect.objectContaining({decision:'returned',note:'Revise dimensions'})));
  expect(screen.getByRole('textbox',{name:'Decision / revision reason'})).toHaveValue('Revise dimensions');
 });
 it('does not expose approval controls to a manager who is not the reviewer',()=>{
  render(<ProjectApprovals state={{...state,canReview:true,data:{...state.data,rfas:[{...request,status:'in_review'}]}}} initialId="rfa" busy={false} error="" run={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Return for revision'})).not.toBeInTheDocument();
 });
 it('preserves new-request edits when closing is cancelled',async()=>{
  render(<ProjectApprovals state={state} busy={false} error="" run={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'New RFA'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Review instructions'}),{target:{value:'Check finish'}});fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(screen.getByRole('dialog',{name:'Discard unsaved RFA changes?'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(screen.getByRole('textbox',{name:'Review instructions'})).toHaveValue('Check finish');
 });
});

it('routes an approval action to the owning project queue and exact request',async()=>{
 const {projectActionRoute}=await import('@/lib/projects/execution');
 expect(projectActionRoute('project',{id:'review_rfa:rfa',kind:'review_rfa',recordId:'rfa',priority:'normal',title:'Review',detail:''})).toBe('/workspace/projects/project/overview?view=approvals&record=rfa');
});
