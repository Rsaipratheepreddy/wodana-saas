"use client";

import Link from 'next/link';
import {StateBadge} from './project-stage';
import {useEffect,useRef,useState} from 'react';
import {Button,ControlledModalDialog,DataGrid,MultiSelectField,SearchInput,SelectField,TextAreaField,TextInput,type DataGridColumn} from '@/design-system';
import type {FactoryAllocationView,FactoryBatchView,FactoryBatchesState} from '../../../../services/business-core/src/projects/project-factory-batches';
import s from './project-factory-batches.module.css';

const label=(value:string)=>value.replaceAll('_',' ');
const emptyDraft=()=>({name:'',operation:'',compatibility:'',resourceId:'',ownerId:'',tasks:[] as string[]});
export function ProjectFactoryBatches({workspaceId,projectId,search=''}:{workspaceId:string;projectId?:string;search?:string}){
 const [localSearch,setLocalSearch]=useState('');
 const [allocationView,setAllocationView]=useState('progress');
 const [data,setData]=useState<FactoryBatchesState>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState(''),[creating,setCreating]=useState(false),[draft,setDraft]=useState(emptyDraft),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState('');
 const retry=useRef<{body:string;requestId:string}|null>(null);
 const endpoint=`/api/factory-batches?${new URLSearchParams({workspaceId,...(projectId?{projectId}:{})})}`;
 useEffect(()=>{
   const controller=new AbortController();
   void fetch(endpoint,{signal:controller.signal}).then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.message??'Could not load factory batches.');if(!controller.signal.aborted){setData(payload);setLoading(false);}}).catch(error=>{if(!controller.signal.aborted){setError(error.message);setLoading(false);}});
   return()=>controller.abort();
 },[endpoint]);
 async function refresh(){
   setLoading(true);setError('');
   try{const response=await fetch(endpoint),payload=await response.json();if(!response.ok)throw Error(payload.message??'Could not load factory batches.');setData(payload);}
   catch(error){setError(error instanceof Error?error.message:'Could not refresh.');}
   finally{setLoading(false);}
 }
 async function save(body:Record<string,unknown>){
   const serial=JSON.stringify(body);
   if(retry.current?.body!==serial)retry.current={body:serial,requestId:crypto.randomUUID()};
   setBusy(true);setError('');setNotice('');
   try{
     const response=await fetch(`/api/factory-batches?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,requestId:retry.current.requestId})});
     const payload=await response.json();if(!response.ok)throw Error(payload.message??'Could not save factory batch.');
     setCreating(false);setCancelling(false);setDraft(emptyDraft());setReason('');retry.current=null;setNotice('Batch saved.');
     await refresh();
   }catch(error){setError(error instanceof Error?error.message:'Could not save factory batch.');}
   finally{setBusy(false);}
 }
 const batch=data?.batches.find(item=>item.id===selected);
 const filter=(projectId?search:localSearch).trim().toLowerCase();
 const selectedTasks=(data?.candidates??[]).filter(item=>draft.tasks.includes(item.key));
 const unit=selectedTasks[0]?.snapshot.unit;
 const columns:DataGridColumn<FactoryBatchView>[]=[
   {accessorKey:'name',header:'Batch',meta:{primary:true}},
   {accessorKey:'operation',header:'Operation'},
   {accessorKey:'resourceName',header:'Workshop'},
   {accessorKey:'ownerName',header:'Responsible'},
   {id:'dates',header:'Planned dates',accessorFn:row=>`${row.start} → ${row.end}`},
   {id:'state',header:projectId?'Project state':'State',accessorFn:row=>label(row.state),meta:{renderCell:row=><StateBadge state={row.state}/>}},
   {id:'actions',header:'Action',meta:{renderCell:row=><Button size="compact" onPress={()=>{setSelected(row.id);setCancelling(false);setReason('');}}>Open batch</Button>}},
 ];
 const allocationColumns:DataGridColumn<FactoryAllocationView>[]=[
   {id:'project',header:'Project / room',accessorFn:row=>`${row.projectName} · ${row.snapshot.area}`},
   {id:'task',header:'Task',accessorFn:row=>row.snapshot.title,meta:{primary:true}},
   {id:'planned',header:'Planned',accessorFn:row=>`${row.snapshot.quantity} ${row.snapshot.unit}`},
   {id:'approved',header:'Approved',accessorFn:row=>`${row.approved} ${row.snapshot.unit}`},
   {id:'qc',header:'QC',size:115,accessorFn:row=>label(row.qc),meta:{renderCell:row=><StateBadge state={row.qc}/>}},
   {accessorKey:'dispatched',header:'Sent · net returns'},
   {accessorKey:'received',header:'Accepted at destination'},
   {accessorKey:'rejected',header:'Rejected at destination'},
   {accessorKey:'returned',header:'Returned to factory'},
   {id:'booking',header:'Booking',accessorFn:row=>row.booked?'Confirmed':'Not confirmed'},
   {id:'source',header:'Source',accessorFn:row=>row.changed?'Changed · review required':`Revision ${row.revision}`,meta:{renderCell:row=><strong>{row.changed?'Changed · review required':`Revision ${row.revision}`}</strong>}},
   {id:'actions',header:'Actions',meta:{renderCell:row=><div className={s.links}><Link href={`/workspace/tasks?projectId=${encodeURIComponent(row.projectId)}&taskId=${encodeURIComponent(row.snapshot.taskId)}`}>Open task</Link><Link href={`/workspace/projects/${row.projectId}/daily-progress`}>Progress</Link><Link href={`/workspace/projects/${row.projectId}/production?view=dispatch`}>Dispatch</Link></div>}},
 ];
 return <section className={s.root} aria-label="Factory batches">
   <div className={s.toolbar}><strong>Shared batches</strong><Button size="compact" isDisabled={loading||busy} onPress={()=>void refresh()}>Refresh batches</Button>{data?.canManage&&<Button size="compact" variant="primary" onPress={()=>{setCreating(true);setError('');}}>Create batch</Button>}</div>
   {notice&&<p role="status">{notice}</p>}
   {error&&!creating&&!cancelling&&<p role="alert">{error}</p>}
   {!projectId&&<SearchInput label="Search factory batches" value={localSearch} onChange={setLocalSearch}/>}
   {loading?<p role="status">Loading batches…</p>:data&&<DataGrid gridLines wrapText columns={columns} data={data.batches.filter(batch=>[batch.name,batch.operation,batch.resourceName,batch.ownerName,...batch.allocations.map(item=>item.projectName)].join(' ').toLowerCase().includes(filter))} ariaLabel="Shared factory batches" getRowId={row=>row.id} rowNumbers={false} selectable={false} showToolbar={false} emptyTitle={filter?"No matching batches":"No factory batches"} emptyDescription="Group compatible factory tasks to track them together."/>}
   {creating&&<ControlledModalDialog isOpen onOpenChange={open=>!busy&&setCreating(open)} title="Create factory batch" size="lg" footer={<><Button isDisabled={busy} onPress={()=>setCreating(false)}>Cancel</Button><Button variant="primary" isDisabled={busy||!draft.name.trim()||!draft.operation.trim()||!draft.compatibility.trim()||!draft.ownerId||!selectedTasks.length||selectedTasks.length!==draft.tasks.length} onPress={()=>void save({action:'create',...draft,tasks:selectedTasks.map(item=>({projectId:item.projectId,taskId:item.snapshot.taskId,revision:item.revision}))})}>Create batch</Button></>}>
     <div className={s.form}>
       {error&&<p role="alert">{error}</p>}
       <TextInput label="Batch name" isRequired value={draft.name} onChange={name=>setDraft(current=>({...current,name}))}/>
       <TextInput label="Common operation" isRequired value={draft.operation} onChange={operation=>setDraft(current=>({...current,operation}))}/>
       <SelectField label="Workshop" isRequired items={data?.resources.map(item=>({id:item.id,label:item.name}))??[]} selectedKey={draft.resourceId||null} onSelectionChange={id=>setDraft(current=>({...current,resourceId:String(id??''),tasks:[]}))}/>
       <SelectField label="Responsible foreman" isRequired items={data?.members.map(item=>({id:item.id,label:item.name}))??[]} selectedKey={draft.ownerId||null} onSelectionChange={id=>setDraft(current=>({...current,ownerId:String(id??'')}))}/>
       <MultiSelectField label="Factory tasks" items={(data?.candidates??[]).filter(item=>item.snapshot.resourceId===draft.resourceId&&(!unit||item.snapshot.unit===unit)).map(item=>({id:item.key,label:`${item.projectName} · ${item.snapshot.title} · ${item.snapshot.quantity} ${item.snapshot.unit}`}))} selectedKeys={new Set(draft.tasks)} onSelectionChange={tasks=>setDraft(current=>({...current,tasks:[...tasks].map(String)}))}/>
       <TextAreaField label="Specification / compatibility evidence" isRequired value={draft.compatibility} onChange={compatibility=>setDraft(current=>({...current,compatibility}))}/>
       <p>Choose complete tasks with the same unit. Existing task bookings, readiness checks and approvals still apply.</p>
     </div>
   </ControlledModalDialog>}
   {batch&&<ControlledModalDialog isOpen onOpenChange={open=>!busy&&!open&&setSelected('')} title={batch.name} size="xl" footer={<><Button isDisabled={busy} onPress={()=>setSelected('')}>Close</Button>{data?.canManage&&!batch.cancelled&&<Button isDisabled={busy} onPress={()=>setCancelling(true)}>Cancel batch</Button>}</>}>
     <div className={s.root}><dl className={s.summary}><div><dt>Operation</dt><dd>{batch.operation}</dd></div><div><dt>Workshop</dt><dd>{batch.resourceName}</dd></div><div><dt>Owner</dt><dd>{batch.ownerName}</dd></div><div><dt>Grouping criteria</dt><dd>{batch.compatibility}</dd></div></dl>{projectId&&<p className={s.scopeNote}>This project’s allocation</p>}{batch.cancelled&&<p className={s.cancelled}><strong>Cancelled</strong> · {batch.cancelled.reason}</p>}
       <div className={s.toolbar} role="group" aria-label="Batch allocation view">{[['progress','Progress & QC'],['delivery','Delivery'],['planning','Planning']].map(([id,title])=><Button key={id} size="compact" variant={allocationView===id?'primary':'secondary'} aria-pressed={allocationView===id} onPress={()=>setAllocationView(id)}>{title}</Button>)}</div>
       <DataGrid gridLines columns={allocationColumns.filter(column=>{const id='accessorKey' in column?column.accessorKey:column.id;return ['project','task','actions',...(allocationView==='delivery'?['dispatched','received','rejected','returned']:allocationView==='planning'?['planned','booking','source']:['planned','approved','qc'])].includes(String(id));})} data={batch.allocations} ariaLabel="Factory batch allocations" getRowId={row=>`${row.projectId}:${row.snapshot.taskId}`} rowNumbers={false} selectable={false} showToolbar={false}/>
       {cancelling&&<div className={s.form}>{error&&<p role="alert">{error}</p>}<TextAreaField label="Cancellation reason" isRequired value={reason} onChange={setReason}/><Button isDisabled={busy||!reason.trim()} onPress={()=>void save({action:'cancel',id:batch.id,version:batch.version,reason})}>Confirm cancellation</Button></div>}
     </div>
   </ControlledModalDialog>}
 </section>;
}
