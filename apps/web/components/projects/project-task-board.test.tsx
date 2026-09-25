import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectTaskBoard} from './project-task-board';
import type {ProjectState,Task} from '@/lib/projects/execution';
const task={id:'t',title:'Fabricate cabinet',status:'planned',location:'office',ownerId:'m',assigneeIds:[],resourceId:'',parentId:'',area:'Kitchen',priority:'normal',start:'2026-10-01',end:'2026-10-05',predecessors:[],quantity:1,approved:0,readiness:{scope:true,access:true,materials:false}} as unknown as Task;
const base={id:'p',canManage:true,canReport:true,canReview:true,commercialReady:true,members:[{id:'m',name:'Manager'}],resources:[],bookings:[],data:{tasks:[task],documents:[],comments:[],workPackages:[]}} as unknown as ProjectState;
describe('task board workflow',()=>{
 it('keeps every stage visible even with only planned work',()=>{
  render(<ProjectTaskBoard state={base} tasks={[task]} busy={false} onOpen={vi.fn()} onComments={vi.fn()} onMove={vi.fn()}/>);
  for(const name of ['Planned','In progress','Waiting','Inspection','Complete']) expect(screen.getByRole('heading',{name})).toBeInTheDocument();
 });
 it('opens missing readiness instead of claiming work has started',()=>{
  const open=vi.fn(),move=vi.fn();
  render(<ProjectTaskBoard state={base} tasks={[task]} busy={false} onOpen={open} onComments={vi.fn()} onMove={move}/>);
  fireEvent.click(screen.getByRole('button',{name:'Review readiness'}));
  expect(open).toHaveBeenCalledWith(task);expect(move).not.toHaveBeenCalled();
 });
 it('connects progress reporting and inspection to actual task actions',()=>{
  const active={...task,status:'in_progress'} as Task, review={...task,id:'r',title:'Install cabinet',status:'awaiting_inspection'} as Task;
  const open=vi.fn(),report=vi.fn();
  render(<ProjectTaskBoard state={{...base,data:{...base.data,tasks:[active,review]}}} tasks={[active,review]} busy={false} onOpen={open} onComments={vi.fn()} onMove={vi.fn()} onReport={report}/>);
  fireEvent.click(screen.getByRole('button',{name:'Update progress'}));expect(report).toHaveBeenCalledWith(active);
  fireEvent.click(screen.getByRole('button',{name:'Review inspection'}));expect(open).toHaveBeenCalledWith(review);
 });
 it('moves a dragged task and requires inspection review before completion',()=>{
  const move=vi.fn(),open=vi.fn();
  const review={...task,id:'r',title:'Inspect cabinet',status:'awaiting_inspection'} as Task;
  const {container}=render(<ProjectTaskBoard state={{...base,data:{...base.data,tasks:[task,review]}}} tasks={[task,review]} busy={false} onOpen={open} onComments={vi.fn()} onMove={move}/>);
  fireEvent.drop(container.querySelector('[data-column="working"]')!,{dataTransfer:{getData:()=>task.id}});
  expect(move).toHaveBeenCalledWith(task,'in_progress');
  fireEvent.drop(container.querySelector('[data-column="done"]')!,{dataTransfer:{getData:()=>review.id}});
  expect(open).toHaveBeenCalledWith(review);
  expect(move).toHaveBeenCalledTimes(1);
 });

});
