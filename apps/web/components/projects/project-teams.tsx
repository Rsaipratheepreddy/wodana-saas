"use client";
import {useState} from 'react';
import Link from 'next/link';
import {Badge,Button,DataGrid,SegmentedControl,type DataGridColumn} from '@/design-system';
import {label,type ProjectState,type ProjectBooking,type ProjectResource,type Task} from '@/lib/projects/execution';
import s from './project-workspace.module.css';
export function ProjectTeams({state,search,onOpen,onBook}:{state:ProjectState;search:string;onOpen:(task:Task)=>void;onBook:(task:Task)=>void}) {
 const [view,setView]=useState('teams');
 const active=state.bookings.filter(item=>['confirmed','tentative'].includes(item.status));
 const pending=state.data.tasks.filter(task=>(task.location!=='office'||task.resourceId)&&!['completed','cancelled'].includes(task.status)&&!active.some(item=>item.projectId===state.id&&item.taskId===task.id&&item.status==='confirmed'));
 const matches=(text:string)=>text.toLowerCase().includes(search.trim().toLowerCase());
 const resources:DataGridColumn<ProjectResource>[]=[
  {accessorKey:'name',header:'Team / resource',size:240,meta:{primary:true}},
  {id:'kind',header:'Type',size:110,accessorFn:row=>label(row.kind)},
  {id:'people',header:'People',size:250,accessorFn:row=>row.members.map(id=>state.members.find(member=>member.id===id)?.name??'Team member').join(', ')||'Capacity resource'},
  {id:'capacity',header:'Capacity units',size:120,accessorFn:row=>row.capacity??1},
  {id:'bookings',header:'Active bookings',size:140,accessorFn:row=>active.filter(item=>item.resourceId===row.id).length},
  {id:'status',header:'Status',size:120,cell:({row})=><Badge tone={row.original.active?'success':'neutral'}>{row.original.active?'Active':'Inactive'}</Badge>},
 ];
 const bookings:DataGridColumn<ProjectBooking>[]=[
  {accessorKey:'taskTitle',header:'Task',size:230,meta:{primary:true}},
  {accessorKey:'projectName',header:'Project',size:220},
  {id:'team',header:'Team',size:200,accessorFn:row=>state.resources.find(item=>item.id===row.resourceId)?.name??'Resource'},
  {id:'dates',header:'Booked dates',size:230,accessorFn:row=>`${row.start}${row.startTime?' '+row.startTime:''} → ${row.end}${row.endTime?' '+row.endTime:''}`},
  {id:'status',header:'Booking',size:130,cell:({row})=><Badge tone={row.original.status==='confirmed'?'success':'warning'}>{label(row.original.status)}</Badge>},
  {id:'action',header:'Action',size:100,cell:({row})=><Link href={`/workspace/projects/${row.original.projectId}/plan-teams?record=${row.original.taskId}`}>Open task</Link>},
 ];
 const unbooked:DataGridColumn<Task>[]=[
  {accessorKey:'title',header:'Task',size:240,meta:{primary:true}},
  {id:'team',header:'Assigned team',size:230,accessorFn:row=>state.resources.find(item=>item.id===row.resourceId)?.name??'Not assigned'},
  {id:'dates',header:'Planned dates',size:210,accessorFn:row=>`${row.start} → ${row.end}`},
  {id:'status',header:'Next step',size:150,cell:({row})=><Badge tone="warning">{row.original.resourceId?'Confirm booking':'Assign team'}</Badge>},
  {id:'action',header:'Action',size:150,cell:({row})=><Button size="compact" onPress={()=>state.canManage&&row.original.resourceId?onBook(row.original):onOpen(row.original)}>{state.canManage&&row.original.resourceId?'Book team':'Open task'}</Button>},
 ];
 return <section className={s.teamsPanel} aria-label="Teams and bookings"><SegmentedControl label="Teams and booking views" value={view} onChange={setView} options={[{id:'teams',label:'Teams'},{id:'bookings',label:`Bookings · ${active.length}`},{id:'pending',label:`Needs booking · ${pending.length}`}]} />
 {view==='teams'?<DataGrid gridLines ariaLabel="Project resources" columns={resources} data={state.resources.filter(row=>matches(row.name))} getRowId={row=>row.id} rowNumbers={false} selectable={false} showToolbar={false} emptyTitle="No teams yet" emptyDescription="Add a team or factory resource to plan assignments."/>:view==='bookings'?<DataGrid gridLines ariaLabel="Active team bookings" columns={bookings} data={active.filter(row=>matches(`${row.taskTitle} ${row.projectName}`))} getRowId={row=>row.id} rowNumbers={false} selectable={false} showToolbar={false} emptyTitle="No active bookings" emptyDescription="Confirm a booking from an assigned task after checking capacity."/>:<DataGrid gridLines ariaLabel="Tasks needing booking" columns={unbooked} data={pending.filter(row=>matches(row.title))} getRowId={row=>row.id} rowNumbers={false} selectable={false} showToolbar={false} emptyTitle="No tasks awaiting booking" emptyDescription="Open tasks with confirmed bookings are ready for the next checks."/>}
 </section>;
}
