"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Badge,Button,Callout,DataGrid,type DataGridColumn} from '@/design-system';
import type {ApprovalQueuePage,ApprovalQueueRow} from '../../../../services/business-core/src/projects/project-approval-queue';
import styles from '../workspace/workspace.module.css';
import {rfaLabels} from '../../../../services/business-core/src/projects/project-rfa';
export function GlobalApprovalTasks({workspaceId,initial,initialError='',showSales=false,embedded=false}:{workspaceId:string;initial:ApprovalQueuePage;initialError?:string;showSales?:boolean;embedded?:boolean}){
 const [page,setPage]=useState(initial),[view,setView]=useState('mine'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(initialError);
 const request=useRef<AbortController|null>(null),sequence=useRef(0);
 const load=useCallback(async(cursor?:string)=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;const token=++sequence.current;
  setBusy(true);setFailure('');
  try{
   const query=new URLSearchParams({workspaceId,view,q:search});if(cursor)query.set('cursor',cursor);
   const response=await fetch(`/api/projects/approvals?${query}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('Approvals could not be loaded. Retry or check your access.');
   const result=await response.json() as ApprovalQueuePage;
   if(!Array.isArray(result.rows))throw Error('The approval queue response was incomplete.');
   if(token!==sequence.current)return;
   setPage(previous=>({...result,rows:cursor?[...previous.rows.filter(row=>!result.rows.some(next=>next.id===row.id)),...result.rows]:result.rows}));
  }catch(error){if(token===sequence.current&&!controller.signal.aborted)setFailure((error as Error).message);}
  finally{if(token===sequence.current)setBusy(false);}
 },[workspaceId,view,search]);
 useEffect(()=>{const pending=request,version=sequence;const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);pending.current?.abort();version.current++;};},[load]);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load]);
 const changeView=(value:string)=>{request.current?.abort();sequence.current++;setBusy(true);setPage(previous=>({...previous,rows:[],nextCursor:null}));setView(value);};
 const columns:DataGridColumn<ApprovalQueueRow>[]=[
  {accessorKey:'title',header:'Approval',size:240,meta:{primary:true},cell:({row})=><Link href={row.original.href}>{row.original.title}</Link>},
  {id:'kind',header:'Type',size:140,accessorFn:row=>row.kind==='order_amendment'?'Order amendment':'RFA'},
  {accessorKey:'projectName',header:'Project',size:190,cell:({row})=><Link href={`/workspace/projects/${row.original.projectId}/overview`}>{row.original.projectName}</Link>},
  {accessorKey:'revision',header:'Revision',size:95},
  {accessorKey:'status',header:'State',size:135,cell:({row})=><Badge tone={row.original.status==='approved'?'success':['returned','rejected'].includes(row.original.status)?'danger':row.original.status==='in_review'?'warning':'neutral'}>{rfaLabels[row.original.status]}</Badge>},
  {accessorKey:'ownerName',header:'Responsible person',size:160},
  {accessorKey:'dueDate',header:'Due date',size:125,cell:({getValue})=><strong>{String(getValue()||'Not set')}</strong>},
  {id:'action',header:'Action',size:130,cell:({row})=><Link className="wd-button" data-size="compact" href={row.original.href}>{page.canReview&&page.memberId===row.original.ownerId&&['submitted','in_review'].includes(row.original.status)?(row.original.kind==='order_amendment'?'Review amendment':'Review RFA'):(row.original.kind==='order_amendment'?'Open amendment':'Open RFA')}</Link>},
 ];
 return <section aria-label="Project approvals">
  {!embedded&&<nav aria-label="Task sources" className={styles.flowTabScroll}><Link className={styles.flowTab} href="/workspace/tasks">Project work</Link>{showSales&&<Link className={styles.flowTab} href="/workspace/crm/follow-ups?view=activity">Sales tasks</Link>}<span className={styles.flowTab} aria-current="page">Project approvals</span></nav>}
  {failure&&<Callout title="Could not refresh approvals" tone="warning">{failure}<Button size="compact" isDisabled={busy} onPress={()=>void load()}>Retry</Button></Callout>}
  <DataGrid gridLines appearance="flush" keepEmptyTable compactToolbar selectable={false} rowNumbers={false} ariaLabel="Global project approvals" columns={columns} data={page.rows} getRowId={row=>row.id} savedViews={[{id:'mine',label:'My work'},{id:'open',label:'Open requests'},{id:'all',label:'All current requests'}]} selectedView={view} onViewChange={changeView} searchLabel="Search projects and approvals" searchValue={search} onSearchChange={value=>{request.current?.abort();sequence.current++;setBusy(true);setPage(previous=>({...previous,rows:[],nextCursor:null}));setSearch(value);}} toolbarActions={<Button size="compact" isDisabled={busy} onPress={()=>void load()}>{busy?'Refreshing…':'Refresh'}</Button>} emptyTitle={busy?'Loading approvals…':failure?'Approval queue unavailable':'No matching approvals'} emptyDescription="" pageSize={50} hasMoreRows={Boolean(page.nextCursor)} footerActions={page.nextCursor?<Button size="compact" isDisabled={busy} onPress={()=>void load(page.nextCursor!)}>Load more approvals</Button>:undefined}/>
 </section>;
}
