import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import type {ProjectState} from '@/lib/projects/execution';
import {ProjectClientUpdates} from './project-client-updates';

function fixture():ProjectState{return {id:'project',memberId:'author',canManage:true,canReport:true,canReview:true,members:[{id:'author',name:'Author'},{id:'reviewer',name:'Reviewer'}],data:{tasks:[{id:'task',title:'Install wardrobe'}],reports:[],orders:[],dispatches:[],snags:[],clientUpdates:[]}} as unknown as ProjectState;}
function submitted(){const state=fixture();state.data.clientUpdates=[{id:'update',title:'Installation delayed',summary:'A replacement is expected tomorrow.',kind:'delay',sourceType:'task',sourceId:'task',status:'submitted',authorId:'author',at:'2026-09-22T10:00:00Z',revision:1}];return state;}

describe('Project client updates',()=>{
 it('preserves a failed draft and never publishes while saving',async()=>{
  const user=userEvent.setup(),run=vi.fn().mockResolvedValue(false);
  render(<ProjectClientUpdates state={fixture()} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'New update'}));
  const dialog=await screen.findByRole('dialog',{name:'New client update'});
  await user.type(within(dialog).getByRole('textbox',{name:'Title'}),'Work this week');
  await user.type(within(dialog).getByRole('textbox',{name:'Client-facing summary'}),'The team will install on Thursday.');
  await user.click(within(dialog).getByRole('button',{name:'Save draft'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('client_update_save',{update:{title:'Work this week',summary:'The team will install on Thursday.',kind:'general'}}));
  expect(within(dialog).getByRole('textbox',{name:'Title'})).toHaveValue('Work this week');
  expect(await within(dialog).findByText('Your changes were not saved. Review the error and try again.')).toBeVisible();
  expect(within(dialog).queryByRole('button',{name:'Approve & publish'})).not.toBeInTheDocument();
 });
 it('requires a linked project record for delay updates',async()=>{
  const user=userEvent.setup(),run=vi.fn().mockResolvedValue(true);
  render(<ProjectClientUpdates state={fixture()} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'New update'}));
  const dialog=await screen.findByRole('dialog',{name:'New client update'});
  await user.type(within(dialog).getByRole('textbox',{name:'Title'}),'Delivery delay');
  await user.type(within(dialog).getByRole('textbox',{name:'Client-facing summary'}),'Replacement due tomorrow.');
  await user.click(within(dialog).getByRole('button',{name:/Update type/}));
  await user.click(screen.getByRole('option',{name:'Delay'}));
  await user.click(within(dialog).getByRole('button',{name:'Save draft'}));
  expect(await within(dialog).findByText('Link the related project record.')).toBeVisible();expect(run).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button',{name:/Related record/}));
  await user.click(screen.getByRole('option',{name:'Task · Install wardrobe'}));
  await user.click(within(dialog).getByRole('button',{name:'Save draft'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('client_update_save',{update:{title:'Delivery delay',summary:'Replacement due tomorrow.',kind:'delay',sourceType:'task',sourceId:'task'}}));
 });
 it('separates author submission from independent publication',async()=>{
  const user=userEvent.setup(),run=vi.fn().mockResolvedValue(true),state=submitted();
  const view=render(<ProjectClientUpdates state={state} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'Open'}));
  let dialog=await screen.findByRole('dialog',{name:'Client update'});
  expect(within(dialog).queryByRole('button',{name:'Approve & publish'})).not.toBeInTheDocument();
  expect(within(dialog).getByText('Another reviewer must approve this update before the client can see it.')).toBeVisible();
  await user.click(within(dialog).getByRole('button',{name:'Close'}));
  view.rerender(<ProjectClientUpdates state={{...state,memberId:'reviewer',canManage:false,canReport:false}} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'Review update'}));
  dialog=await screen.findByRole('dialog',{name:'Client update'});
  expect(within(dialog).getByRole('link',{name:'Task · Install wardrobe'})).toHaveAttribute('href','/workspace/tasks?projectId=project&taskId=task');
  await user.click(within(dialog).getByRole('button',{name:'Approve & publish'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('client_update_publish',{id:'update'}));
 });
 it('submits only a saved draft and disables submission with unsaved edits',async()=>{
  const state=submitted();state.data.clientUpdates![0].status='draft';const user=userEvent.setup(),run=vi.fn().mockResolvedValue(true);
  render(<ProjectClientUpdates state={state} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'Open'}));
  const dialog=await screen.findByRole('dialog',{name:'Client update'});
  await user.type(within(dialog).getByRole('textbox',{name:'Title'}),' revised');
  expect(within(dialog).getByRole('button',{name:'Submit for review'})).toBeDisabled();
  await user.clear(within(dialog).getByRole('textbox',{name:'Title'}));
  await user.type(within(dialog).getByRole('textbox',{name:'Title'}),'Installation delayed');
  await user.click(within(dialog).getByRole('button',{name:'Submit for review'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('client_update_submit',{id:'update'}));
 });
 it('keeps published text read-only and saves only chosen section visibility',async()=>{
  const state=submitted();state.data.clientUpdates![0].status='published';const user=userEvent.setup(),run=vi.fn().mockResolvedValue(true);
  render(<ProjectClientUpdates state={state} busy={false} error="" run={run}/>);
  await user.click(screen.getByRole('button',{name:'Open'}));
  let dialog=await screen.findByRole('dialog',{name:'Client update'});
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();expect(within(dialog).queryByRole('button',{name:'Save draft'})).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button',{name:'Close'}));
  await user.click(screen.getByRole('button',{name:'Client sections'}));
  dialog=await screen.findByRole('dialog',{name:'Client sections'});
  await user.click(within(dialog).getByRole('checkbox',{name:'Daily progress'}));
  await user.click(within(dialog).getByRole('button',{name:'Save visibility'}));
  await waitFor(()=>expect(run).toHaveBeenCalledWith('client_sections_save',{sections:{progress:false,documents:true,handover:true,updates:true}}));
 });
});
