"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';
import {Filter,RefreshCw} from 'lucide-react';
import type {ProjectState,ProjectResource} from '@/lib/projects/execution';
const TaskRecord=dynamic(()=>import('./project-workspace').then(module=>module.ProjectWorkspace));
import {Avatar,Button,Callout,SearchInput,SelectField,InspectorSheet} from '@/design-system';
import {GlobalWorkBoard} from './global-work-board';
import {GlobalTaskTransition,type BoardTaskStatus} from './global-task-transition';
import {GlobalWorkDetail} from './global-work-detail';
import boardStyles from './global-work-board.module.css';
import type {WorkQueuePage,WorkQueueRow} from '../../../../services/business-core/src/projects/project-work-queue';
import type {TaskBoardPage,TaskBoardRow} from '../../../../services/business-core/src/projects/project-task-board';
const taskSection=(location:string)=>location==='factory'?'production':location==='site'?'site-work':'plan-teams';
/** Board rows are project tasks only; other work lives in its own module or in Approvals. */
export function taskBoardRow(row:TaskBoardRow):WorkQueueRow{
 return {id:`${row.projectId}:task:${row.id}`,recordId:row.id,projectId:row.projectId,projectName:row.projectName,clientName:row.clientName,kind:'task',title:row.title,status:row.status,ownerId:row.ownerId,ownerName:row.ownerName||'Unassigned',dueDate:row.end,href:`/workspace/projects/${encodeURIComponent(row.projectId)}/${taskSection(row.location)}?record=${encodeURIComponent(row.id)}`,location:row.location,area:row.area,priority:row.priority,waitingFor:row.waitingFor,overdue:row.overdue};
}
export function GlobalProjectWork({workspaceId,initial,initialError='',showSales=false,fixedProjectId='',resources=[],embedded=false,onProjectStateChange}:{workspaceId:string;initial:WorkQueuePage;initialError?:string;showSales?:boolean;fixedProjectId?:string;resources?:ProjectResource[];embedded?:boolean;onProjectStateChange?:(state:ProjectState)=>void}){
 const route=useSearchParams();
 const directProjectId=route?.get('projectId')??'';
 const directTaskId=route?.get('taskId')??'';
 const [page,setPage]=useState(initial),[view,setView]=useState(fixedProjectId?'open':'mine'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(initialError);
 const current=useRef<AbortController|null>(null),sequence=useRef(0);
 const [projectId,setProjectId]=useState(fixedProjectId),[ownerId,setOwnerId]=useState('');
 const [peopleSearch,setPeopleSearch]=useState('');
 const peopleMenu=useRef<HTMLDetailsElement|null>(null);
 const [location,setLocation]=useState(''),[priority,setPriority]=useState('');
 const [opened,setOpened]=useState<{row:WorkQueueRow;tab:string;state?:ProjectState;error?:string}|null>(null);
 const [editing,setEditing]=useState(false);
 const recordRequest=useRef(0);
 useEffect(()=>()=>{recordRequest.current++;},[]);
 async function openTask(row:WorkQueueRow,tab='details'){
  const version=++recordRequest.current;setEditing(row.kind==='task'&&tab!=='details');setOpened({row,tab:tab==='edit'?'details':tab});
  try{const response=await fetch(`/api/projects/${encodeURIComponent(row.projectId)}/execution?workspaceId=${encodeURIComponent(workspaceId)}`,{cache:'no-store'});if(!response.ok)throw Error('Could not open this record. Check project access and retry.');const state=await response.json() as ProjectState;const records={task:state.data?.tasks,report:state.data?.reports,order:state.data?.orders,dispatch:state.data?.dispatches,snag:state.data?.snags,handover:state.data?.handovers};if(!records[row.kind]?.some(record=>record.id===row.recordId))throw Error('This record is no longer available. Refresh the board.');if(version===recordRequest.current)setOpened({row,tab,state});}catch(error){if(version===recordRequest.current)setOpened({row,tab,error:(error as Error).message});}
 }
 useEffect(()=>{
  if(!directProjectId||!directTaskId||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(directProjectId)||directTaskId.length>80)return;
  const version=++recordRequest.current;
  const controller=new AbortController();
  const open=async()=>{
   try{
    const response=await fetch(`/api/projects/${encodeURIComponent(directProjectId)}/execution?workspaceId=${encodeURIComponent(workspaceId)}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Could not open this task. Check project access and retry.');
    const state=await response.json() as ProjectState;
    const task=state.data.tasks.find(item=>item.id===directTaskId);
    if(!task)throw Error('This task is no longer available. Refresh Home.');
    const row:WorkQueueRow={id:`${directProjectId}:task:${task.id}`,recordId:task.id,projectId:directProjectId,projectName:state.name,kind:'task',title:task.title,status:task.status,ownerId:task.ownerId,ownerName:state.members.find(member=>member.id===task.ownerId)?.name??'Unassigned',dueDate:task.end,href:`/workspace/projects/${encodeURIComponent(directProjectId)}/${task.location==='factory'?'production':task.location==='site'?'site-work':'plan-teams'}?record=${encodeURIComponent(task.id)}`,location:task.location,area:task.area,priority:task.priority,resourceId:task.resourceId,resourceName:state.resources.find(resource=>resource.id===task.resourceId)?.name??''};
    if(version===recordRequest.current)setOpened({row,tab:'details',state});
   }catch(failure){if(version===recordRequest.current&&!controller.signal.aborted)setError((failure as Error).message);}
  };
  void open();
  return()=>{controller.abort();recordRequest.current++;};
 },[directProjectId,directTaskId,workspaceId]);
 const [moving,setMoving]=useState<{row:WorkQueueRow;status:BoardTaskStatus}|null>(null);
 const [sort,setSort]=useState('due');
 const load=useCallback(async(cursor?:string)=>{
  current.current?.abort();const controller=new AbortController();current.current=controller;const version=++sequence.current;
  setBusy(true);setError('');
  try{
   const query=new URLSearchParams({workspaceId,view:view==='mine'?'mine':'all',q:search,location,priority,...(projectId?{projectId}:{}),...(ownerId?{ownerId}:{})});if(cursor)query.set('cursor',cursor);
   const response=await fetch(`/api/projects/task-board?${query}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('Tasks could not be loaded. Retry or check your access.');
   const board=await response.json() as TaskBoardPage;
   if(!Array.isArray(board.rows))throw Error('The task response was incomplete.');
   const next:WorkQueuePage={...board,rows:board.rows.map(taskBoardRow)};
   if(sequence.current===version)setPage(previous=>({...next,rows:cursor?[...previous.rows.filter(row=>!next.rows.some(item=>item.id===row.id)),...next.rows]:next.rows}));
  }catch(failure){if(sequence.current===version&&!controller.signal.aborted)setError((failure as Error).message);}
  finally{if(sequence.current===version)setBusy(false);}
 },[workspaceId,view,search,projectId,ownerId,location,priority]);
 useEffect(()=>{const request=current,version=sequence;const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);request.current?.abort();version.current++;};},[load]);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load]);
 const reset=()=>{current.current?.abort();sequence.current++;setBusy(true);setPage(previous=>({...previous,rows:[],nextCursor:null}));};
 const selectOwner=(id:string)=>{reset();setOwnerId(id);setView('all');setPeopleSearch('');if(peopleMenu.current)peopleMenu.current.open=false;};
 const closeTask=()=>{recordRequest.current++;setOpened(null);setEditing(false);if(directProjectId&&directTaskId){const url=new URL(window.location.href);url.searchParams.delete('projectId');url.searchParams.delete('taskId');window.history.replaceState(null,'',url);}void load();};
 const members=page.members??[];
 const matchingMembers=members.filter(member=>member.name.toLocaleLowerCase().includes(peopleSearch.trim().toLocaleLowerCase()));
 const selectedMember=members.find(member=>member.id===ownerId);
 const sortedRows=useMemo(()=>[...page.rows].sort((a,b)=>{
  if(sort==='project')return a.projectName.localeCompare(b.projectName)||a.title.localeCompare(b.title);
  if(sort==='priority'){const order:Record<string,number>={urgent:0,high:1,normal:2};return (order[a.priority??'normal']??3)-(order[b.priority??'normal']??3)||a.title.localeCompare(b.title);}
  return (a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||a.title.localeCompare(b.title);
 }),[page.rows,sort]);
 return <section className={boardStyles.page} aria-label="Global project work">
  {!embedded&&<div className={boardStyles.boardHeader}><nav aria-label="Task boards" className={boardStyles.boardSwitcher}>{showSales&&<Link href="/workspace/crm/follow-ups?view=activity">Sales</Link>}<Link aria-current="page" href="/workspace/tasks">Projects</Link></nav></div>}
  {error&&<Callout title="Could not refresh project work" tone="warning"><div className={boardStyles.errorActions}><span>{error}</span><Button size="compact" isDisabled={busy} onPress={()=>void load()}>Retry</Button></div></Callout>}
  <div className={boardStyles.toolbar}>
   <SearchInput label="Search tasks" placeholder="Search tasks…" value={search} onChange={value=>{reset();setSearch(value);}}/>
   <SelectField label="Sort by" selectedKey={sort} items={[{id:'due',label:'Due date'},{id:'priority',label:'Priority'},{id:'project',label:'Project'}]} onSelectionChange={key=>setSort(String(key))}/>
   <details className={boardStyles.filterMenu}><summary><Filter size={15} aria-hidden="true"/>Filter</summary><div className={boardStyles.filterPanel}>
    <SelectField label="Project" isDisabled={!!fixedProjectId} selectedKey={projectId||'all'} items={[{id:'all',label:'All projects'},...(page.projects??[]).map(project=>({id:project.id,label:project.name})),...(fixedProjectId&&!page.projects?.some(project=>project.id===fixedProjectId)?[{id:fixedProjectId,label:'This project'}]:[])]} onSelectionChange={key=>{reset();setProjectId(key==='all'?'':String(key));}}/>
    <SelectField label="Location" selectedKey={location||"all"} items={[{id:"all",label:"All locations"},{id:"factory",label:"Factory"},{id:"site",label:"Site"},{id:"office",label:"Office"}]} onSelectionChange={key=>{reset();setLocation(key==="all"?"":String(key));}}/>
    <SelectField label="Priority" selectedKey={priority||"all"} items={[{id:"all",label:"All priorities"},{id:"normal",label:"Normal"},{id:"high",label:"High"},{id:"urgent",label:"Urgent"}]} onSelectionChange={key=>{reset();setPriority(key==="all"?"":String(key));}}/>
    <div className={boardStyles.group} role="group" aria-label="Work filter">{[['mine','My work'],['open','Everyone'],['all','All work']].map(([id,title])=><Button key={id} size="compact" variant={view===id?"primary":"secondary"} aria-pressed={view===id} onPress={()=>{reset();setOwnerId('');setView(id);}}>{title}</Button>)}</div>
   </div></details>
   <div className={boardStyles.toolbarTrailing}>
    {!embedded&&<div className={boardStyles.boardPeople}>
     <div className={boardStyles.peopleAvatars} role="group" aria-label="Filter tasks by assignee">{members.slice(0,5).map((member,index)=><button key={member.id} type="button" className={boardStyles.personButton} aria-label={`Show tasks assigned to ${member.name}`} aria-pressed={ownerId===member.id} title={member.name} onClick={()=>selectOwner(ownerId===member.id?'':member.id)}><Avatar name={member.name} size="sm" colorVariant={index}/></button>)}</div>
     <details ref={peopleMenu} className={boardStyles.peoplePicker} data-selected={Boolean(ownerId&&!members.slice(0,5).some(member=>member.id===ownerId))}><summary aria-label="Choose assignee" title={selectedMember?`Filtering by ${selectedMember.name}`:ownerId==='unassigned'?'Filtering by Unassigned':'Choose assignee'}>{members.length>5?`+${members.length-5}`:'+'}</summary><div className={boardStyles.peopleMenu}>
      <SearchInput label="Search assignees" placeholder="Search people…" value={peopleSearch} onChange={setPeopleSearch}/>
      <button type="button" className={boardStyles.peopleOption} aria-pressed={!ownerId&&view==='all'} onClick={()=>selectOwner('')}>All assignees</button>
      <button type="button" className={boardStyles.peopleOption} aria-pressed={ownerId==='unassigned'} onClick={()=>selectOwner('unassigned')}>Unassigned</button>
      {matchingMembers.map(member=><button key={member.id} type="button" className={boardStyles.peopleOption} aria-label={member.name} aria-pressed={ownerId===member.id} onClick={()=>selectOwner(member.id)}><Avatar name={member.name} size="sm"/>{member.name}</button>)}
      {!matchingMembers.length&&<p className={boardStyles.peopleEmpty}>No people found</p>}
     </div></details>
    </div>}
    <Button size="compact" variant="quiet" aria-label="Refresh project board" isDisabled={busy} onPress={()=>void load()}><RefreshCw size={15} aria-hidden="true"/>{busy?'Refreshing…':'Refresh'}</Button>
   </div>
  </div>
  <GlobalWorkBoard rows={sortedRows} busy={busy} error={error} hasMore={Boolean(page.nextCursor)} onOpenTask={(row,tab)=>void openTask(row,tab)} onMoveTask={page.canManage?(row,status)=>setMoving({row,status}):undefined}/>{page.nextCursor&&<Button size="compact" isDisabled={busy} onPress={()=>void load(page.nextCursor!)}>Load more work</Button>}
  {opened?.state&&editing&&opened.row.kind==='task'?<TaskRecord key={`${opened.row.id}:${opened.tab}`} initial={opened.state} section="plan-teams" recordOnly initialRecordId={opened.row.recordId} initialDetailTab={opened.tab} onStateChange={onProjectStateChange} onRecordClose={closeTask}/>:opened?<InspectorSheet isOpen title={opened.row.title} onOpenChange={open=>!open&&closeTask()}>{opened.error?<><p role="alert">{opened.error}</p><Button onPress={()=>void openTask(opened.row,opened.tab)}>Retry</Button></>:opened.state?<GlobalWorkDetail row={opened.row} state={opened.state} onEdit={opened.row.kind==='task'?()=>setEditing(true):undefined} onProgress={opened.row.kind==='task'&&opened.state.canReport&&opened.row.status==='in_progress'?()=>{setOpened({...opened,tab:'updates'});setEditing(true);}:undefined} onMove={opened.row.kind==='task'&&opened.state.canManage?(status)=>setMoving({row:opened.row,status}):undefined}/>:<p role="status">Loading record…</p>}</InspectorSheet>:null}
  {moving&&<GlobalTaskTransition workspaceId={workspaceId} row={moving.row} status={moving.status} onClose={()=>setMoving(null)} onSaved={state=>{onProjectStateChange?.(state);setOpened(previous=>previous?.row.id===moving.row.id?{...previous,state,row:{...previous.row,status:state.data.tasks.find(task=>task.id===moving.row.recordId)?.status??previous.row.status}}:previous);setMoving(null);void load();}}/>}
 </section>;
}
