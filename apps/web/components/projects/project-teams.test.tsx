import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import type {ProjectState,Task} from '@/lib/projects/execution';
import {ProjectTeams} from './project-teams';
describe('Teams and bookings',()=>{
 it('separates pending bookings from completed and already confirmed tasks',async()=>{
  const tasks=[{id:'open',title:'Unbooked installation',location:'site',resourceId:'crew',status:'planned'},{id:'complete',title:'Completed installation',location:'site',resourceId:'crew',status:'completed'},{id:'confirmed',title:'Reserved installation',location:'site',resourceId:'crew',status:'planned'}] as Task[];
  const state={id:'project',canManage:true,members:[],resources:[{id:'crew',name:'Installation team',kind:'crew',members:[],active:true}],data:{tasks},bookings:[{id:'booking',projectId:'project',projectName:'Villa',taskId:'confirmed',taskTitle:'Reserved installation',resourceId:'crew',status:'confirmed',start:'2026-09-22',end:'2026-09-23'}]} as unknown as ProjectState;
  const book=vi.fn();render(<ProjectTeams state={state} search="" onOpen={vi.fn()} onBook={book}/>);
  await userEvent.click(screen.getByRole('radio',{name:'Needs booking · 1'}));
  expect(screen.queryByText('Completed installation')).not.toBeInTheDocument();
  expect(screen.queryByText('Reserved installation')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Book team'}));expect(book).toHaveBeenCalledWith(tasks[0]);
  await userEvent.click(screen.getByRole('radio',{name:'Bookings · 1'}));
  expect(screen.getByText('Reserved installation')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Open task'})).toHaveAttribute('href','/workspace/projects/project/plan-teams?record=confirmed');
 });
});
