"use client";

import {useState} from "react";
import Link from "next/link";
import {Badge,Button,Callout,Checkbox,ControlledModalDialog,DataGrid,SelectField,TextAreaField,TextInput,type DataGridColumn} from "@/design-system";
import type {ProjectState} from "@/lib/projects/execution";
import styles from "./project-client-updates.module.css";

type Update = NonNullable<ProjectState['data']['clientUpdates']>[number];
type Sections = {progress:boolean;documents:boolean;handover:boolean;updates:boolean};
type Props = {state:ProjectState;busy:boolean;error:string;run:(action:string,input:Record<string,unknown>)=>Promise<boolean>};
const kinds=[{id:'general',label:'General'},{id:'progress',label:'Progress'},{id:'delay',label:'Delay'},{id:'issue',label:'Issue'},{id:'delivery',label:'Delivery'}];
const defaults:Sections={progress:true,documents:true,handover:true,updates:true};
const sectionLabels:Record<keyof Sections,string>={progress:'Daily progress',documents:'Project documents',handover:'Handover',updates:'Client updates'};
const statusLabel={draft:'Draft',submitted:'Awaiting review',published:'Published',withdrawn:'Withdrawn'};

export function ProjectClientUpdates({state,busy,error,run}:Props){
 const [selected,setSelected]=useState<string|null>(null),[settings,setSettings]=useState(false),[search,setSearch]=useState('');
 const updates=state.data.clientUpdates??[];
 const selectedUpdate=updates.find(update=>update.id===selected);
 const columns:DataGridColumn<Update>[]=[
  {id:'title',header:'Update',size:310,meta:{primary:true},accessorFn:update=>update.title,cell:({row})=><div className={styles.subject}><strong>{row.original.title}</strong><span>{row.original.summary}</span></div>},
  {id:'kind',header:'Type',size:115,accessorFn:update=>update.kind,cell:({row})=><Badge tone={row.original.kind==='delay'?'warning':row.original.kind==='issue'?'danger':'info'}>{kinds.find(kind=>kind.id===row.original.kind)?.label}</Badge>},
  {id:'status',header:'Status',size:150,accessorFn:update=>statusLabel[update.status],cell:({row})=><Badge tone={row.original.status==='published'?'success':row.original.status==='submitted'?'warning':'neutral'}>{statusLabel[row.original.status]}</Badge>},
  {id:'author',header:'Prepared by',size:160,accessorFn:update=>state.members.find(member=>member.id===update.authorId)?.name??'Team member'},
  {id:'action',header:'Action',size:145,cell:({row})=><Button size="compact" onPress={()=>setSelected(row.original.id)}>{row.original.status==='submitted'&&state.canReview&&row.original.authorId!==state.memberId?'Review update':'Open'}</Button>},
 ];
 return <section className={styles.page} aria-label="Client updates">
  {error&&!selected&&!settings&&<Callout title="Could not save client settings" tone="danger">{error}</Callout>}
  <DataGrid ariaLabel="Client updates" gridLines compactToolbar keepEmptyTable columns={columns} data={updates.filter(update=>`${update.title} ${update.summary}`.toLowerCase().includes(search.toLowerCase()))} getRowId={update=>update.id} selectable={false} rowNumbers={false} onRowAction={update=>setSelected(update.id)} searchLabel="Search client updates" searchValue={search} onSearchChange={setSearch} toolbarActions={<>{state.canReview&&<Button size="compact" isDisabled={busy} onPress={()=>setSettings(true)}>Client sections</Button>}{(state.canManage||state.canReport)&&<Button size="compact" variant="primary" isDisabled={busy} onPress={()=>setSelected('new')}>New update</Button>}</>} emptyTitle="No client updates yet" emptyDescription="Prepare an update, then have another reviewer approve it for the client."/>
  {(selected==='new'||selectedUpdate)&&<UpdateEditor key={selected} {...{state,busy,error,run}} update={selectedUpdate} onClose={()=>setSelected(null)}/>}
  {settings&&<SectionEditor {...{state,busy,error,run}} onClose={()=>setSettings(false)}/>}
 </section>;
}

function UpdateEditor({state,busy,error,run,update,onClose}:Props&{update?:Update;onClose:()=>void}){
 const [title,setTitle]=useState(update?.title??''),[summary,setSummary]=useState(update?.summary??''),[kind,setKind]=useState(update?.kind??'general');
 const [source,setSource]=useState(update?.sourceType&&update.sourceId?`${update.sourceType}:${update.sourceId}`:''),[failure,setFailure]=useState('');
 const mayAuthor=state.canManage||(state.canReport&&(!update||update.authorId===state.memberId));
 const editable=mayAuthor&&update?.status!=='published';
 const sources=[
  ...state.data.tasks.map(item=>({id:`task:${item.id}`,label:`Task · ${item.title}`,href:`/workspace/tasks?projectId=${encodeURIComponent(state.id)}&taskId=${encodeURIComponent(item.id)}`})),
  ...state.data.reports.map(item=>({id:`report:${item.id}`,label:`Daily progress · ${item.date} · ${item.location}`,href:`/workspace/projects/${state.id}/daily-progress?record=${item.id}`})),
  ...state.data.orders.map(item=>({id:`order:${item.id}`,label:`Order · ${item.number} · ${item.title}`,href:`/workspace/projects/${state.id}/procurement?record=${item.id}`})),
  ...(state.data.dispatches??[]).map(item=>({id:`dispatch:${item.id}`,label:`Dispatch · ${item.title}`,href:`/workspace/projects/${state.id}/production?view=dispatch&record=${item.id}`})),
  ...state.data.snags.map(item=>({id:`snag:${item.id}`,label:`Issue · ${item.title}`,href:`/workspace/projects/${state.id}/snagging?record=${item.id}`})),
 ];
 const dirty=title!==(update?.title??'')||summary!==(update?.summary??'')||kind!==(update?.kind??'general')||source!==(update?.sourceType&&update.sourceId?`${update.sourceType}:${update.sourceId}`:'');
 async function command(action:string,input:Record<string,unknown>){
  setFailure('');
  try{if(await run(action,input))onClose();else setFailure('Your changes were not saved. Review the error and try again.');}
  catch(problem){setFailure(problem instanceof Error?problem.message:'Could not save this update. Your draft is preserved.');}
 }
 function save(){
  if(!title.trim()||!summary.trim()){setFailure('Add a title and client-facing summary.');return;}
  if(kind!=='general'&&!source){setFailure('Link the related project record.');return;}
  const [sourceType,sourceId]=source.split(':');
  void command('client_update_save',{update:{...(update?{id:update.id}:{}),title:title.trim(),summary:summary.trim(),kind,...(source?{sourceType,sourceId}:{})}});
 }
 const linked=sources.find(item=>item.id===source);
 return <ControlledModalDialog isOpen size="lg" title={update?'Client update':'New client update'} isDismissable={!busy} onOpenChange={open=>{if(!open&&!busy)onClose();}} footer={<div className={styles.actions}>
  <Button isDisabled={busy} onPress={onClose}>Close</Button>
  {editable&&<Button isDisabled={busy||(!dirty&&!!update)} variant="primary" onPress={save}>Save draft</Button>}
  {update?.status==='draft'&&mayAuthor&&<Button isDisabled={busy||dirty} onPress={()=>void command('client_update_submit',{id:update.id})}>Submit for review</Button>}
  {update?.status==='submitted'&&state.canReview&&update.authorId!==state.memberId&&<Button variant="primary" isDisabled={busy||dirty} onPress={()=>void command('client_update_publish',{id:update.id})}>Approve & publish</Button>}
  {update&&['submitted','published'].includes(update.status)&&state.canReview&&<Button isDisabled={busy} onPress={()=>void command('client_update_withdraw',{id:update.id})}>Withdraw</Button>}
 </div>}><div className={styles.editor}>
  {(error||failure)&&<Callout tone="danger" title="Update not saved">{error||failure}</Callout>}
  {update&&<div className={styles.meta}><Badge tone={update.status==='published'?'success':update.status==='submitted'?'warning':'neutral'}>{statusLabel[update.status]}</Badge><span>Revision {update.revision}</span></div>}
  {editable?<><TextInput label="Title" value={title} onChange={setTitle} maxLength={200} isDisabled={busy}/><SelectField label="Update type" selectedKey={kind} items={kinds} onSelectionChange={key=>setKind(String(key) as Update['kind'])} isDisabled={busy}/><SelectField label="Related record" selectedKey={source||'none'} items={[{id:'none',label:'No linked record'},...sources]} onSelectionChange={key=>setSource(key==='none'?'':String(key))} isDisabled={busy}/><TextAreaField label="Client-facing summary" value={summary} onChange={setSummary} maxLength={3000} isDisabled={busy}/></>:<><h3 className={styles.title}>{title}</h3><p className={styles.summary}>{summary}</p>{linked&&<Link href={linked.href}>{linked.label}</Link>}</>}
  {update?.status==='submitted'&&update.authorId===state.memberId&&<p className={styles.hint}>Another reviewer must approve this update before the client can see it.</p>}
  {update?.status==='published'&&<p className={styles.hint}>Published to the client. Withdraw before changing this update.</p>}
 </div></ControlledModalDialog>;
}

function SectionEditor({state,busy,error,run,onClose}:Props&{onClose:()=>void}){
 const [sections,setSections]=useState<Sections>({...defaults,...state.data.clientSections}),[failure,setFailure]=useState('');
 async function save(){setFailure('');try{if(await run('client_sections_save',{sections}))onClose();else setFailure('Section visibility was not saved. Try again.');}catch(problem){setFailure(problem instanceof Error?problem.message:'Could not save section visibility.');}}
 return <ControlledModalDialog isOpen title="Client sections" isDismissable={!busy} onOpenChange={open=>{if(!open&&!busy)onClose();}} footer={<div className={styles.actions}><Button isDisabled={busy} onPress={onClose}>Cancel</Button><Button variant="primary" isDisabled={busy} onPress={()=>void save()}>Save visibility</Button></div>}><div className={styles.editor}>{(error||failure)&&<Callout tone="danger" title="Visibility not saved">{error||failure}</Callout>}<p className={styles.hint}>Choose which project sections the client can see. Records still need their own publication approval.</p>{(Object.keys(sectionLabels) as (keyof Sections)[]).map(key=><Checkbox key={key} isDisabled={busy} isSelected={sections[key]} onChange={checked=>setSections(current=>({...current,[key]:checked}))}>{sectionLabels[key]}</Checkbox>)}</div></ControlledModalDialog>;
}
