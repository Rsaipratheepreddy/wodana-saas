"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button, Callout, DataGrid, SearchInput, type DataGridColumn } from '@/design-system';
import type { WorkQueuePage, WorkQueueRow } from '../../../../services/business-core/src/projects/project-work-queue';
import { StateBadge } from './project-stage';
import styles from './global-supply-page.module.css';

type GlobalFactoryQueueProps = {
  workspaceId:string; initial:WorkQueuePage; initialError?:string; kind:'task'|'dispatch';
};

export function GlobalFactoryQueue(props: GlobalFactoryQueueProps) {
  return <GlobalFactoryQueueContent key={`${props.workspaceId}:${props.kind}`} {...props}/>;
}

function GlobalFactoryQueueContent({workspaceId,initial,initialError='',kind}: GlobalFactoryQueueProps) {
  const [page,setPage]=useState(initial);
  const [search,setSearch]=useState('');
  const [error,setError]=useState(initialError);
  const [busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null);
  const firstSearch=useRef(true);
  const load=async(cursor?:string,query=search)=>{
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');
    try {
      const params=new URLSearchParams({workspaceId,view:'open',kind,q:query});
      if(kind==='task')params.set('location','factory');
      if(cursor)params.set('cursor',cursor);
      const response=await fetch(`/api/projects/work-queue?${params}`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('Factory work could not be loaded. Check your access and retry.');
      const next=await response.json() as WorkQueuePage;
      if(!Array.isArray(next.rows))throw Error('The factory response was incomplete. Retry.');
      if(!controller.signal.aborted)setPage(previous=>({...next,rows:cursor?[...previous.rows,...next.rows]:next.rows}));
    } catch(failure) {
      if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Factory work could not be loaded.');
    } finally {
      if(!controller.signal.aborted)setBusy(false);
    }
  };
  useEffect(()=>{
    if(firstSearch.current){firstSearch.current=false;return;}
    const timer=window.setTimeout(()=>void load(undefined,search),250);
    return()=>window.clearTimeout(timer);
  // Search is the only automatic reload trigger; refresh and pagination call load directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[search,kind]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const columns=useMemo<DataGridColumn<WorkQueueRow>[]>(()=>[
    {accessorKey:'title',header:kind==='task'?'Job':'Shipment',size:320,meta:{primary:true},cell:({row})=><Link className={styles.record} href={row.original.href}>{row.original.title||'Untitled dispatch'}</Link>},
    {accessorKey:'projectName',header:'Project',size:220},
    ...(kind==='task'?[{accessorKey:'resourceName',header:'Workshop',size:175,cell:({row})=>row.original.resourceName||'Unassigned'}] as DataGridColumn<WorkQueueRow>[]:[]),
    {accessorKey:'dueDate',header:kind==='task'?'Due':'Ship by',size:130,cell:({row})=>row.original.dueDate||'—'},
    {accessorKey:'status',header:'State',size:150,cell:({row})=><StateBadge state={row.original.status}/>},
    {id:'action',header:'',size:125,cell:({row})=><Link className={styles.action} href={row.original.href}>{kind==='task'?'Open job':'Open dispatch'}</Link>},
  ],[kind]);
  return <>
    {error&&<Callout title="Could not refresh factory work" tone="warning"><div className={styles.error}>{error}<Button size="compact" isDisabled={busy} onPress={()=>void load()}>Retry</Button></div></Callout>}
    <div className={styles.toolbar}><SearchInput label={kind==='task'?'Search factory jobs':'Search dispatches'} placeholder={kind==='task'?'Search jobs…':'Search dispatches…'} value={search} onChange={setSearch}/><Button size="compact" variant="quiet" isDisabled={busy} onPress={()=>void load()}><RefreshCw size={14}/>{busy?'Refreshing…':'Refresh'}</Button></div>
    <DataGrid appearance="contained" wrapText ariaLabel={kind==='task'?'Factory jobs':'Factory dispatches'} columns={columns} data={page.rows} getRowId={row=>row.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} hasMoreRows={Boolean(page.nextCursor)} footerActions={page.nextCursor?<Button size="compact" isDisabled={busy} onPress={()=>void load(page.nextCursor!)}>Load more</Button>:undefined} emptyTitle={busy?'Loading…':search?'No matching records':kind==='task'?'No factory jobs yet':'No dispatches yet'} emptyDescription={search?'Try a different search.':kind==='task'?'Factory work planned in projects will appear here.':'Dispatches prepared from approved factory output will appear here.'}/>
  </>;
}
