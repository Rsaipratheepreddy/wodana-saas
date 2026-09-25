"use client";
import {useState} from 'react';
import Link from 'next/link';
import {Badge,Button,ControlledModalDialog,DataGrid,DateField,SelectField,TextAreaField,useConfirmationDialog,type DataGridColumn} from '@/design-system';
import {parseDate} from '@internationalized/date';
import type {ProjectRfa,ProjectState} from '@/lib/projects/execution';
import {currentRfas,rfaLabels} from '../../../../services/business-core/src/projects/project-rfa';
import {documentHref} from './project-stage';
import s from './project-work-plan-editor.module.css';
type Props={scopeLineIds?:string[];state:ProjectState;busy:boolean;error:string;run:(action:string,input:Record<string,unknown>)=>Promise<boolean>;initialId?:string|null};
export function ProjectApprovals({state,busy,error,run,initialId,scopeLineIds}:Props){
  const [selected,setSelected]=useState(initialId??'');
  const [creating,setCreating]=useState(false);
  const [query,setQuery]=useState('');
  const [view,setView]=useState('open');
  const allowedDocuments=scopeLineIds?state.data.documents.filter(doc=>doc.scopeLineIds?.some(id=>scopeLineIds.includes(id))).map(doc=>doc.id):undefined;
  const all=(state.data.rfas??[]).filter(request=>!allowedDocuments||allowedDocuments.includes(request.documentId)||request.snapshot?.scope.some(line=>scopeLineIds?.includes(line.id)));
  const title=(request:ProjectRfa)=>request.snapshot?.document.title??state.data.documents.find(doc=>doc.id===request.documentId)?.title??'Document unavailable';
  const current=currentRfas(state.data).filter(request=>all.some(item=>item.id===request.id));
  const rows=(view==='all'?all:current.filter(request=>view==='mine'?request.reviewerId===state.memberId&&['submitted','in_review'].includes(request.status):!['approved','withdrawn'].includes(request.status))).filter(request=>`${title(request)} ${rfaLabels[request.status]}`.toLowerCase().includes(query.toLowerCase()));
  const columns:DataGridColumn<ProjectRfa>[]=[
    {id:'document',header:'Document',size:250,accessorFn:title,meta:{primary:true}},
    {id:'revision',header:'Revision',size:95,accessorFn:request=>request.snapshot?.document.revision??state.data.documents.find(doc=>doc.id===request.documentId)?.revision??'—'},
    {id:'state',header:'State',size:130,accessorFn:request=>rfaLabels[request.status],cell:({row,getValue})=><Badge tone={row.original.status==='approved'?'success':['returned','rejected'].includes(row.original.status)?'danger':row.original.status==='in_review'?'warning':'neutral'}>{String(getValue())}</Badge>},
    {id:'reviewer',header:'Reviewer',size:165,accessorFn:request=>state.members.find(member=>member.id===request.reviewerId)?.name??'Unassigned'},
    {accessorKey:'dueDate',header:'Due date',size:120,cell:({row})=><strong>{row.original.dueDate||'Not set'}</strong>},
    {id:'action',header:'Action',size:130,cell:({row})=><span data-grid-interactive><Button size="compact" onPress={()=>setSelected(row.original.id)}>{state.canReview&&row.original.reviewerId===state.memberId&&['submitted','in_review'].includes(row.original.status)?'Review RFA':'Open RFA'}</Button></span>},
  ];
  const request=all.find(item=>item.id===selected);
  return <>
    <DataGrid gridLines appearance="flush" keepEmptyTable compactToolbar selectable={false} rowNumbers={false} ariaLabel="Project approvals" data={rows} columns={columns} getRowId={request=>request.id} onRowAction={request=>setSelected(request.id)} searchLabel="Search approvals" searchValue={query} onSearchChange={setQuery} savedViews={[{id:'open',label:'Open requests'},{id:'mine',label:'My reviews'},{id:'all',label:'All requests'}]} selectedView={view} onViewChange={setView} toolbarActions={<><Link href={`/workspace/projects/${state.id}/documents`}>Documents</Link>{state.canManage?<Button size="compact" variant="primary" isDisabled={busy} onPress={()=>setCreating(true)}>New RFA</Button>:null}</>} emptyTitle="No approval requests" emptyDescription=""/>
    {(creating||request)&&<RfaEditor scopeLineIds={scopeLineIds} key={creating?'new':request!.id} state={state} request={creating?undefined:request} busy={busy} error={error} run={run} onClose={()=>{setCreating(false);setSelected('');}}/>}
  </>;
}
function RfaEditor({state,request,busy,error,run,onClose,scopeLineIds}:Props&{request?:ProjectRfa;onClose:()=>void}){
  const [id]=useState(request?.id??crypto.randomUUID());
  const [version]=useState(request?.version??0);
  const [documentId,setDocumentId]=useState(request?.documentId??'');
  const [reviewerId,setReviewerId]=useState(request?.reviewerId??'');
  const [dueDate,setDueDate]=useState(request?.dueDate??'');
  const [instructions,setInstructions]=useState(request?.instructions??'');
  const [note,setNote]=useState('');
  const [validation,setValidation]=useState('');
  const {confirmationDialog,requestConfirmation}=useConfirmationDialog();
  const dirty=documentId!==(request?.documentId??'')||reviewerId!==(request?.reviewerId??'')||dueDate!==(request?.dueDate??'')||instructions!==(request?.instructions??'')||!!note;
  const close=()=>{if(busy)return;if(dirty)requestConfirmation({title:'Discard unsaved RFA changes?',body:'Your saved request stays unchanged.',onConfirm:onClose});else onClose();};
  const latest=!request||!state.data.rfas?.some(item=>item.revisionOf===request?.id);
  const editable=state.canManage&&(!request||request.status==='draft')&&latest;
  const reviewing=state.canReview&&request?.reviewerId===state.memberId&&request?.submittedBy!==state.memberId&&latest;
  const document=request?.snapshot?.document??state.data.documents.find(doc=>doc.id===documentId);
  async function command(action:string,extra:Record<string,unknown>={}){
    setValidation('');
    if(['rfa_withdraw','rfa_revise'].includes(action)||(action==='rfa_decide'&&extra.decision!=='approved')){if(!note.trim()){setValidation('Enter a reason.');return;}}
    if(await run(action,{id,version,note,...extra}))onClose();
  }
  const documents=state.data.documents.filter(doc=>doc.id===documentId||(doc.status==='draft'&&!state.data.rfas?.some(item=>item.documentId===doc.id)&&(!scopeLineIds||doc.scopeLineIds?.some(id=>scopeLineIds.includes(id)))));
  const snapshot=request?.snapshot;
  return <><ControlledModalDialog isOpen title={request?'RFA · '+(document?.title??'Document'):'New RFA'} size="lg" isDismissable={!busy} onOpenChange={open=>{if(!open)close();}} footer={<div className={s.footer}>
    <Button isDisabled={busy} onPress={close}>Close</Button>
    {editable&&<Button isDisabled={busy} variant="primary" onPress={()=>{if(!documentId){setValidation('Choose a document.');return;}void command('rfa_save',{documentId,reviewerId,dueDate,instructions});}}>Save draft</Button>}
    {request?.status==='draft'&&state.canManage&&latest&&<Button isDisabled={busy||dirty} variant="primary" onPress={()=>command('rfa_submit')}>Submit RFA</Button>}
    {reviewing&&request?.status==='submitted'&&<Button isDisabled={busy} variant="primary" onPress={()=>command('rfa_review')}>Start review</Button>}
    {reviewing&&request?.status==='in_review'&&<><Button isDisabled={busy} onPress={()=>command('rfa_decide',{decision:'returned'})}>Return for revision</Button><Button isDisabled={busy} onPress={()=>command('rfa_decide',{decision:'rejected'})}>Reject</Button><Button isDisabled={busy} variant="primary" onPress={()=>command('rfa_decide',{decision:'approved'})}>Approve</Button></>}
  </div>}><div className={s.editor}>
    {request&&<div><Badge tone={request.status==='approved'?'success':['returned','rejected'].includes(request.status)?'danger':'neutral'}>{rfaLabels[request.status]}</Badge> · Version {request.version}</div>}
    {(validation||error)&&<p role="alert" className={s.error}>{validation||error}</p>}
    {editable?<>
      <SelectField label="Document revision" selectedKey={documentId||null} isDisabled={busy||!!request?.revisionOf} items={documents.map(doc=>({id:doc.id,label:`${doc.title} · ${doc.revision}`}))} onSelectionChange={key=>setDocumentId(String(key??''))}/>
      <SelectField label="Reviewer" selectedKey={reviewerId||null} isDisabled={busy} items={state.members.filter(member=>member.id!==state.memberId&&member.canReview!==false).map(member=>({id:member.id,label:member.name}))} onSelectionChange={key=>setReviewerId(String(key??''))}/>
      <DateField label="Review due date" value={dueDate?parseDate(dueDate):null} isDisabled={busy} onChange={date=>setDueDate(date?.toString()??'')}/>
      <TextAreaField label="Review instructions" value={instructions} maxLength={3000} isDisabled={busy} onChange={setInstructions}/>
    </>:<><dl className={s.recordFacts}><div><dt>Revision</dt><dd>{document?.revision}</dd></div><div><dt>Reviewer</dt><dd>{state.members.find(member=>member.id===request?.reviewerId)?.name??'Unavailable'}</dd></div><div><dt>Due date</dt><dd>{request?.dueDate||'Not set'}</dd></div></dl>{request?.instructions&&<p>{request.instructions}</p>}</>}
    {document&&<div>{documentHref(state,document)&&<a href={documentHref(state,document)} target="_blank" rel="noreferrer">Open document · {document.revision}</a>}{document.note&&<p>{document.note}</p>}</div>}
    {snapshot&&<DataGrid gridLines appearance="flush" compactToolbar showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} ariaLabel="Submitted BOQ scope" data={snapshot.scope} getRowId={line=>line.id} columns={[{accessorKey:'title',header:'Item',size:220},{accessorKey:'room',header:'Room',size:130},{id:'quantity',header:'BOQ quantity',size:120,accessorFn:line=>`${line.quantity} ${line.unit}`}]} />}
    {request&&latest&&request.status!=='approved'&&((state.canManage)||reviewing)&&<TextAreaField label="Decision / revision reason" value={note} maxLength={3000} isDisabled={busy} onChange={setNote}/>}
    {request&&latest&&state.canManage&&<div className={s.taskToolbar}>{['returned','rejected','withdrawn'].includes(request.status)&&<Button isDisabled={busy} onPress={()=>command('rfa_revise',{newId:crypto.randomUUID()})}>Create RFA revision</Button>}{!['approved','withdrawn'].includes(request.status)&&<Button isDisabled={busy} onPress={()=>command('rfa_withdraw')}>Withdraw RFA</Button>}</div>}
    {request?.revisionOf&&<p>Revises request {request.revisionOf}</p>}
    {!!request?.history.length&&<details><summary>History ({request.history.length})</summary><ol>{request.history.map((event,index)=><li key={index}>{event.action.replaceAll('rfa_','').replaceAll('_',' ')} · {state.members.find(member=>member.id===event.actorId)?.name??event.actorId} · {event.at}{event.note?` · ${event.note}`:''}</li>)}</ol></details>}
  </div></ControlledModalDialog>{confirmationDialog}</>;
}
