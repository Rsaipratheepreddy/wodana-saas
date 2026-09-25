"use client";
import {useEffect,useState} from 'react';
import {Button,DateField,DataGrid,IconMenuButton,type DataGridColumn} from '@/design-system';
import {parseDate} from '@internationalized/date';
import type {ProjectState,Task} from '@/lib/projects/execution';
import s from './project-workspace.module.css';

type Segment={date:string;endDate?:string;startTime:string;endTime:string;capacity:number;confirmed:number;tentative:number;remaining:number;overCapacity:boolean};
type Response={range:{from:string;to:string};resources:{id:string;name:string;kind:string;timezone:string}[];availability:{resourceId:string;segments:Segment[]}[]};
type Row=Segment&{id:string;resourceId:string;name:string;timezone:string};
export function ProjectFactoryCapacity({state,onBook,search=''}:{state:ProjectState;onBook:(task:Task)=>void;search?:string}) {
 const initial=state.today??new Date().toISOString().slice(0,10);
 const [from,setFrom]=useState(initial),[to,setTo]=useState(initial),[query,setQuery]=useState({from:initial,to:initial,attempt:0});
 const [result,setResult]=useState<{data?:Response;error?:string;loading:boolean}>({loading:true});
 useEffect(()=>{
  const controller=new AbortController();
  const params=new URLSearchParams({workspaceId:state.workspaceId,from:query.from,to:query.to});
  void fetch(`/api/project-capacity?${params}`,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.message??'Could not load capacity.');if(!Array.isArray(data.resources)||!Array.isArray(data.availability))throw new Error('Capacity response incomplete.');if(!controller.signal.aborted)setResult({data,loading:false});}).catch(error=>{if(!controller.signal.aborted)setResult({error:error.message,loading:false});});
  return()=>controller.abort();
 },[state.workspaceId,state.bookings,query]);
 const rows:Row[]=(result.data?.resources??[]).filter(resource=>['factory','crew'].includes(resource.kind)&&resource.name.toLowerCase().includes(search.trim().toLowerCase())).flatMap(resource=>(result.data!.availability.find(item=>item.resourceId===resource.id)?.segments??[]).map((segment,index)=>({...segment,id:`${resource.id}:${index}`,resourceId:resource.id,name:resource.name,timezone:resource.timezone})));
 const columns:DataGridColumn<Row>[]=[
  {id:'resource',header:'Factory / team',accessorFn:row=>row.name,meta:{primary:true}},
  {id:'shift',header:'Working shift',accessorFn:row=>`${row.date} ${row.startTime} → ${row.endDate??row.date} ${row.endTime}`},
  {accessorKey:'timezone',header:'Timezone'},
  {accessorKey:'capacity',header:'Capacity'},
  {accessorKey:'confirmed',header:'Confirmed'},
  {accessorKey:'tentative',header:'Tentative'},
  {id:'remaining',header:'Available units',accessorFn:row=>row.remaining,meta:{renderCell:row=><strong>{row.overCapacity?'Over capacity':row.remaining}</strong>}},
  {id:'actions',header:'Action',meta:{renderCell:row=>{
    const tasks=state.data.tasks.filter(task=>task.location==='factory'&&task.resourceId===row.resourceId&&!['completed','cancelled'].includes(task.status)&&!state.bookings.some(booking=>booking.projectId===state.id&&booking.taskId===task.id&&booking.status==='confirmed'));
    return state.canManage&&tasks.length?<IconMenuButton ariaLabel={`Book task · ${row.name} · ${row.date} ${row.startTime}`} items={tasks.map(task=>({id:task.id,label:task.title}))} onAction={id=>{const task=tasks.find(task=>task.id===id);if(task)onBook(task);}}/>:null;
  }}},
 ];
 return <section className={s.factoryCapacity} aria-label="Factory capacity">
  <form className={s.row} onSubmit={event=>{event.preventDefault();setResult({loading:true});setQuery({from,to,attempt:query.attempt+1});}}><DateField label="Capacity from" isRequired value={from?parseDate(from):null} onChange={value=>setFrom(value?.toString()??'')}/><DateField label="Capacity to" isRequired value={to?parseDate(to):null} onChange={value=>setTo(value?.toString()??'')}/><Button type="submit" size="compact" isDisabled={result.loading}>Check capacity</Button></form>
  <p className={s.muted}>Capacity units, not finished items. Tentative holds are shown separately; confirmation rechecks availability.</p>
  {result.loading?<p role="status">Loading capacity…</p>:result.error?<p role="alert" className={s.error}>{result.error}</p>:<><p>{result.data?.range.from} → {result.data?.range.to}</p><DataGrid gridLines ariaLabel="Factory capacity shifts" columns={columns} data={rows} getRowId={row=>row.id} rowNumbers={false} selectable={false} showToolbar={false} emptyTitle="No working shifts" emptyDescription="No visible factory or crew has working slots in this range."/></>}
 </section>;
}
