"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Badge,Button,Callout,DataGrid,type DataGridColumn} from '@/design-system';
import type {ApprovalQueuePage,ApprovalQueueRow} from '../../../../services/business-core/src/projects/project-approval-queue';
import styles from '../workspace/workspace.module.css';
import {rfaLabels} from '../../../../services/business-core/src/projects/project-rfa';
export function GlobalApprovalTasks({workspaceId,initial,initialError='',showSales=false,embedded=false}:{workspaceId:string;initial:ApprovalQueuePage;initialError?:string;showSales?:boolean;embedded?:boolean}){
  const t = useT();
 const [page,setPage]=useState(initial),[view,setView]=useState('mine'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(initialError);
 const request=useRef<AbortController|null>(null),sequence=useRef(0);
 const load=useCallback(async(cursor?:string)=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;const token=++sequence.current;
  setBusy(true);setFailure('');
  try{
   const query=new URLSearchParams({workspaceId,view,q:search});if(cursor)query.set('cursor',cursor);
   const response=await fetch(`/api/projects/approvals?${query}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error(tKey('Approvals could not be loaded. Retry or check your access.'));
   const result=await response.json() as ApprovalQueuePage;
   if(!Array.isArray(result.rows))throw Error(tKey('The approval queue response was incomplete.'));
   if(token!==sequence.current)return;
   setPage(previous=>({...result,rows:cursor?[...previous.rows.filter(row=>!result.rows.some(next=>next.id===row.id)),...result.rows]:result.rows}));
  }catch(error){if(token===sequence.current&&!controller.signal.aborted)setFailure((error as Error).message);}
  finally{if(token===sequence.current)setBusy(false);}
 },[workspaceId,view,search]);
 useEffect(()=>{const pending=request,version=sequence;const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);pending.current?.abort();version.current++;};},[load]);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load]);
 const changeView=(value:string)=>{request.current?.abort();sequence.current++;setBusy(true);setPage(previous=>({...previous,rows:[],nextCursor:null}));setView(value);};
 const columns:DataGridColumn<ApprovalQueueRow>[]=[
  {accessorKey:'title',header:t('Approval'),size:240,meta:{primary:true},cell:({row})=><Link href={row.original.href}>{row.original.title}</Link>},
  {id:'kind',header:t('Type'),size:140,accessorFn:row=>row.kind==='order_amendment'?t('Order amendment'):'RFA'},
  {accessorKey:'projectName',header:t('Project'),size:190,cell:({row})=><Link href={`/workspace/projects/${row.original.projectId}/overview`}>{row.original.projectName}</Link>},
  {accessorKey:'revision',header:t('Revision'),size:95},
  {accessorKey:'status',header:t('State'),size:135,cell:({row})=><Badge tone={row.original.status==='approved'?'success':['returned','rejected'].includes(row.original.status)?'danger':row.original.status==='in_review'?'warning':'neutral'}>{t(rfaLabels[row.original.status] as never)}</Badge>},
  {accessorKey:'ownerName',header:t('Responsible person'),size:160},
  {accessorKey:'dueDate',header:t('Due date'),size:125,cell:({getValue})=><strong>{String(getValue()||t('Not set'))}</strong>},
  {id:'action',header:t('Action'),size:130,cell:({row})=><Link className="wd-button" data-size="compact" href={row.original.href}>{page.canReview&&page.memberId===row.original.ownerId&&['submitted','in_review'].includes(row.original.status)?(row.original.kind==='order_amendment'?t('Review amendment'):t('Review RFA')):(row.original.kind==='order_amendment'?t('Open amendment'):t('Open RFA'))}</Link>},
 ];
 return <section aria-label={t("Project approvals")}>
  {!embedded&&<nav aria-label={t("Task sources")} className={styles.flowTabScroll}><Link className={styles.flowTab} href="/workspace/tasks">{t("Project work")}</Link>{showSales&&<Link className={styles.flowTab} href="/workspace/crm/follow-ups?view=activity">{t("Sales tasks")}</Link>}<span className={styles.flowTab} aria-current="page">{t("Project approvals")}</span></nav>}
  {failure&&<Callout title={t("Could not refresh approvals")} tone="warning">{translateKnown(t, failure)}<Button size="compact" isDisabled={busy} onPress={()=>void load()}>{t("Retry")}</Button></Callout>}
  <DataGrid gridLines keepEmptyTable compactToolbar selectable={false} rowNumbers={false} ariaLabel={t("Global project approvals")} columns={columns} data={page.rows} getRowId={row=>row.id} savedViews={[{id:'mine',label:t('My work')},{id:'open',label:t('Open requests')},{id:'all',label:t('All current requests')}]} selectedView={view} onViewChange={changeView} searchLabel={t("Search projects and approvals")} searchValue={search} onSearchChange={value=>{request.current?.abort();sequence.current++;setBusy(true);setPage(previous=>({...previous,rows:[],nextCursor:null}));setSearch(value);}} toolbarActions={<Button size="compact" isDisabled={busy} onPress={()=>void load()}>{busy?t('Refreshing…'):t('Refresh')}</Button>} emptyTitle={busy?t('Loading approvals…'):failure?t('Approval queue unavailable'):t('No matching approvals')} emptyDescription="" pageSize={50} hasMoreRows={Boolean(page.nextCursor)} footerActions={page.nextCursor?<Button size="compact" isDisabled={busy} onPress={()=>void load(page.nextCursor!)}>{t("Load more approvals")}</Button>:undefined}/>
 </section>;
}
