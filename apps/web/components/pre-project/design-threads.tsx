'use client';
import {useState} from 'react';
import {Check, MessageSquare, Plus, Reply, RotateCcw} from 'lucide-react';
import {Button, Checkbox, useDesignSystem} from '@/design-system';
import {caseRequest, type CaseContent, type CaseDesign, type DesignOptions, type DesignThread, type DesignVersion} from '@/lib/pre-project/content';
import {CaseModal} from './case-controls';
import styles from './case-content.module.css';
import view from './designs.module.css';

export function DesignThreads({data,design,revision,options,onUpdate}:{data:CaseContent;design:CaseDesign;revision:DesignVersion;options:DesignOptions;onUpdate:(d:CaseDesign)=>void}) {
 const {locale,timeZone}=useDesignSystem();
 const date=(value:string)=>new Intl.DateTimeFormat(locale,{timeZone,day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const [composer,setComposer]=useState(false),[resolved,setResolved]=useState(false),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const [comment,setComment]=useState(''),[commentId,setCommentId]=useState(()=>crypto.randomUUID());
 const [replyTo,setReplyTo]=useState<string|null>(null),[reply,setReply]=useState(''),[replyId,setReplyId]=useState(()=>crypto.randomUUID());
 const all=(design.threads??[]).filter(t=>t.versionId===revision.id),shown=all.filter(t=>resolved||t.status==='open');
 const comments=design.activity.filter(a=>a.versionId===revision.id&&a.action==='comment');
 const writable=data.canEdit&&!design.archivedAt;
 async function change(thread:DesignThread){setBusy(thread.id);setError('');try{onUpdate(await caseRequest<CaseDesign>(data.workspaceId,data.caseId,`designs/${design.id}/threads/${thread.id}/status`,'POST',{version:thread.version,status:thread.status==='open'?'resolved':'open'}));}catch(e){setError(e instanceof Error?e.message:'Could not update discussion.');}finally{setBusy(null);}}
 async function post(threadId?:string){setBusy(threadId??'comment');setError('');try{const saved=await caseRequest<CaseDesign>(data.workspaceId,data.caseId,threadId?`designs/${design.id}/threads/${threadId}/replies`:`designs/${design.id}/activity`,'POST',threadId?{id:replyId,body:reply}:{id:commentId,version:design.version,versionId:revision.id,action:'comment',note:comment,decisionBy:''});onUpdate(saved);if(threadId){setReplyTo(null);setReply('');setReplyId(crypto.randomUUID());}else{setComment('');setCommentId(crypto.randomUUID());}}catch(e){setError(e instanceof Error?e.message:'Could not post. Your text is kept here.');}finally{setBusy(null);}}
 const author=(name:string,at:string)=><div className={view.messageMeta}><span className={view.avatar}>{name.slice(0,1).toUpperCase()}</span><strong title={name}>{name.includes('@')?name.split('@')[0]:name}</strong><time dateTime={at}>{date(at)}</time></div>;
 return <section className={view.discussions} aria-label="Revision discussions">
  <div className={view.discussionHeading}><div><h2>Comments & threads</h2><p>Internal · Revision {revision.number}</p></div>{writable&&<Button size="compact" variant="quiet" onPress={()=>setComposer(true)}><Plus size={14}/>Thread</Button>}</div>
  {writable&&<form className={view.inlineComposer} onSubmit={e=>{e.preventDefault();void post();}}><label htmlFor="design-comment">Add a comment</label><textarea id="design-comment" placeholder="Share quick feedback…" rows={2} value={comment} disabled={busy==='comment'} maxLength={5000} onChange={e=>setComment(e.target.value)}/><div><small>Feedback only · does not approve the file</small><Button type="submit" size="compact" variant="primary" isDisabled={!comment.trim()||Boolean(busy)} isLoading={busy==='comment'}>Post comment</Button></div></form>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {comments.map(c=><article key={c.id} className={view.plainComment}>{author(c.createdByName,c.createdAt)}<p>{c.note}</p></article>)}
  <div className={view.threadListHeading}><strong>{all.filter(t=>t.status==='open').length} open {all.filter(t=>t.status==='open').length===1?'thread':'threads'}</strong><Checkbox isSelected={resolved} onChange={setResolved}>Show resolved</Checkbox></div>
  {!shown.length&&<div className={view.threadEmpty}><MessageSquare size={22}/><p>{all.length?'No open threads.':'Start a thread when feedback needs a discussion or a decision.'}</p></div>}
  {shown.map(thread=><article key={thread.id} className={view.thread}>
   <header><h3>{thread.title}</h3><span className={view.threadFlag}>{thread.status==='resolved'?<><Check size={12}/>Resolved</>:thread.blocking?'Blocks approval':'Open'}</span></header>
   <ol>{thread.messages.map(message=><li key={message.id}>{author(message.createdByName,message.createdAt)}<p>{message.body}</p></li>)}</ol>
   {thread.status==='resolved'&&<small className={styles.muted}>Resolved by {thread.resolvedByName}</small>}
   {writable&&<div className={view.threadActions}>{thread.status==='open'&&<Button size="compact" variant="quiet" onPress={()=>{setReplyTo(thread.id);setReply('');setReplyId(crypto.randomUUID());}}><Reply size={13}/>Reply</Button>}{(thread.createdBy===options.actorId||revision.reviewerId===options.actorId)&&<Button size="compact" variant="quiet" isDisabled={Boolean(busy)} isLoading={busy===thread.id} onPress={()=>void change(thread)}>{thread.status==='open'?<Check size={13}/>:<RotateCcw size={13}/>} {thread.status==='open'?'Resolve':'Reopen'}</Button>}</div>}
   {replyTo===thread.id&&<form className={view.inlineComposer} onSubmit={e=>{e.preventDefault();void post(thread.id);}}><label htmlFor={`reply-${thread.id}`}>Your reply</label><textarea autoFocus id={`reply-${thread.id}`} rows={2} maxLength={5000} value={reply} disabled={Boolean(busy)} onChange={e=>setReply(e.target.value)}/><div><Button size="compact" variant="quiet" isDisabled={Boolean(busy)} onPress={()=>setReplyTo(null)}>Cancel</Button><Button type="submit" size="compact" variant="primary" isDisabled={!reply.trim()||Boolean(busy)}>Post reply</Button></div></form>}
  </article>)}
  {composer&&<ThreadComposer data={data} design={design} revision={revision} onClose={()=>setComposer(false)} onSaved={d=>{onUpdate(d);setComposer(false);}}/>}
 </section>;
}
function ThreadComposer({data,design,revision,onClose,onSaved}:{data:CaseContent;design:CaseDesign;revision:DesignVersion;onClose:()=>void;onSaved:(d:CaseDesign)=>void}) {
 const [id]=useState(()=>crypto.randomUUID());const [title,setTitle]=useState(''),[body,setBody]=useState(''),[blocking,setBlocking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <CaseModal size="md" title="Start a thread" description={`${design.title} · Revision ${revision.number}`} onClose={onClose} busy={busy} dirty={Boolean(title||body||blocking)} footer={<Button variant="primary" type="submit" form="thread-compose" isDisabled={!title.trim()||!body.trim()} isLoading={busy}>Start thread</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<form id="thread-compose" onSubmit={async e=>{e.preventDefault();setBusy(true);try{onSaved(await caseRequest<CaseDesign>(data.workspaceId,data.caseId,`designs/${design.id}/threads`,'POST',{id,versionId:revision.id,title,body,blocking}));}catch(e){setError(e instanceof Error?e.message:'Could not post.');}finally{setBusy(false);}}}>
 <label>Topic<input required maxLength={240} disabled={busy} value={title} placeholder="e.g. Reception lighting" onChange={e=>setTitle(e.target.value)}/></label>
 <label>What needs discussing?<textarea required maxLength={5000} rows={3} disabled={busy} value={body} onChange={e=>setBody(e.target.value)}/></label>
 {revision.status!=='approved'&&<Checkbox isSelected={blocking} isDisabled={busy} onChange={setBlocking}>Must be resolved before approval</Checkbox>}
 </form></CaseModal>;
}
