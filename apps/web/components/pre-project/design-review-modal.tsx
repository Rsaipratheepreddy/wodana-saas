'use client';
import {useEffect,useRef,useState} from 'react';
import {Send, MessageCircle, ChevronDown, MapPin, X} from 'lucide-react';
import {Button, Avatar, SelectField, useDesignSystem} from '@/design-system';
import {caseApi,caseRequest,type CaseContent,type CaseDesign,type DesignOptions} from '@/lib/pre-project/content';
import {CaseModal} from './case-controls';
import {FileCover} from './design-file-preview';
import s from './design-review-modal.module.css';
export function DesignReviewModal({data,design,options,onClose,onUpdate}:{data:CaseContent;design:CaseDesign;options:DesignOptions;onClose:()=>void;onUpdate:(d:CaseDesign)=>void}) {
 const [revisionId,setRevisionId]=useState(design.versions[0]?.id);
 const revision=design.versions.find(item=>item.id===revisionId)??design.versions[0];
 const [expanded,setExpanded]=useState<string[]>([]);
 const {locale,timeZone}=useDesignSystem();
 const date=(value:string)=>new Intl.DateTimeFormat(locale,{timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const [replyTo,setReplyTo]=useState<string|null>(null),[reply,setReply]=useState(''),[replyId,setReplyId]=useState(()=>crypto.randomUUID());
 async function postReply(threadId:string){if(!reply.trim()||busy||!writable)return;setBusy(true);setError('');try{onUpdate(await caseRequest<CaseDesign>(data.workspaceId,data.caseId,`designs/${design.id}/threads/${threadId}/replies`,'POST',{id:replyId,body:reply.trim()}));setReply('');setReplyTo(null);setExpanded(v=>v.includes(threadId)?v:[...v,threadId]);setReplyId(crypto.randomUUID());}catch(e){setError(e instanceof Error?e.message:'Could not send reply.');}finally{setBusy(false);}}

 const [zoom,setZoom]=useState(1),[commentMode,setCommentMode]=useState(false),[imageSize,setImageSize]=useState({width:0,height:0});
 const viewport=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),image=useRef<HTMLImageElement>(null);
 const sizeImage=()=>{const img=image.current,bounds=viewport.current;if(!img?.naturalWidth||!bounds)return;const ratio=Math.min(bounds.clientWidth/img.naturalWidth,(bounds.clientHeight||320)/img.naturalHeight)*.94;setImageSize({width:img.naturalWidth*ratio,height:img.naturalHeight*ratio});};
 useEffect(()=>{const observer=new ResizeObserver(sizeImage);if(viewport.current)observer.observe(viewport.current);return()=>observer.disconnect();},[revision?.id]);
 const fit=()=>{sizeImage();setZoom(1);viewport.current?.scrollTo({left:0,top:0});};
 const [point,setPoint]=useState<{x:number;y:number}|null>(null),[body,setBody]=useState(''),[mentions,setMentions]=useState<string[]>([]),[active,setActive]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[id,setId]=useState(()=>crypto.randomUUID());
 const writable=data.canEdit&&!design.archivedAt&&revision?.id===design.versions[0]?.id;
 const members=options.members??options.reviewers;
 const [mentionQuery,setMentionQuery]=useState<{start:number;end:number;query:string}|null>(null),[highlight,setHighlight]=useState(0);
 const suggestions=mentionQuery?members.filter(m=>m.name.toLocaleLowerCase().includes(mentionQuery.query.toLocaleLowerCase())).slice(0,8):[];
 function detectMention(text:string,caret:number){const match=text.slice(0,caret).match(/(?:^|\s)@([^@\n]*)$/);setMentionQuery(match?{start:caret-match[1].length-1,end:caret,query:match[1]}:null);setHighlight(0);}
 function selectMention(member:{id:string;name:string}){if(!mentionQuery)return;const text=`${body.slice(0,mentionQuery.start)}@${member.name} ${body.slice(mentionQuery.end)}`;const caret=mentionQuery.start+member.name.length+2;setBody(text);setMentions(old=>old.includes(member.id)?old:[...old,member.id].slice(0,20));setMentionQuery(null);requestAnimationFrame(()=>{composer.current?.focus();composer.current?.setSelectionRange(caret,caret);});}

 const threads=(design.threads??[]).filter(t=>t.versionId===revision?.id);
 const asset=revision?.asset;
 const pinnable=Boolean(asset&&(asset.mimeType.startsWith('image/')||asset.hasPreview));
 async function post(){if(busy||!writable||!body.trim()||!revision)return;setBusy(true);setError('');try {onUpdate(await caseRequest<CaseDesign>(data.workspaceId,data.caseId,`designs/${design.id}/threads`,'POST',{id,versionId:revision.id,title:body.trim().slice(0,240),body:body.trim(),blocking:false,...(point?{anchor:point}:{}),mentions:mentions.filter(id=>body.includes(`@${members.find(m=>m.id===id)?.name}`))}));setBody('');setPoint(null);setMentions([]);setId(crypto.randomUUID());}catch(e){setError(e instanceof Error?e.message:'Could not post comment.');}finally{setBusy(false);}}
 return <CaseModal size="xl" title={design.scopeTitle??design.roomName??design.title} onClose={onClose} dirty={Boolean(body.trim()||reply.trim())} busy={busy}>
  <div className={s.revisionBar}>
   <SelectField label="Revision" selectedKey={revision?.id??null} isDisabled={busy||Boolean(body.trim()||reply.trim())} items={design.versions.map(item=>({id:item.id,label:`R${item.number}${item.id===design.versions[0]?.id?' · Latest':''}`}))} onSelectionChange={key=>{if(key){setRevisionId(String(key));setPoint(null);setActive(null);setCommentMode(false);setReplyTo(null);setExpanded([]);fit();}}}/>
   {asset&&<a href={caseApi(data.workspaceId,data.caseId,`assets/${asset.id}`)} download>Download file</a>}
   {revision?.id!==design.versions[0]?.id&&<small>Earlier revision · read-only</small>}
   {!writable&&(body.trim()||reply.trim())&&<div><p>Your unsent comment: {body || reply}</p><Button size="compact" variant="quiet" onPress={()=>{setBody('');setReply('');setPoint(null);setMentions([]);setReplyTo(null);}}>Discard unsent comment</Button></div>}
  </div>
  <div className={s.review}>
   <div className={s.canvas}>
    <div className={s.toolbar}>
     <Button size="compact" aria-pressed={commentMode} isDisabled={!writable} onPress={()=>setCommentMode(v=>!v)}>{commentMode?'Cancel pin':'Add comment'}</Button>
     <div><Button size="compact" aria-label="Zoom out" isDisabled={zoom<=0.5} onPress={()=>setZoom(v=>Math.max(.5,v-.25))}>−</Button><span aria-live="polite">{Math.round(zoom*100)}%</span><Button size="compact" aria-label="Zoom in" isDisabled={zoom>=4} onPress={()=>setZoom(v=>Math.min(4,v+.25))}>+</Button><Button size="compact" onPress={fit}>Fit</Button></div>
    </div>
   <div className={s.preview} ref={viewport}>
   <div className={s.stage}>
    {pinnable&&asset?<div className={s.imageFrame} style={imageSize.width?{width:imageSize.width*zoom,height:imageSize.height*zoom}:undefined}>
     {/* Authenticated image; pins use coordinates relative to the image itself. */}
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img ref={image} onLoad={sizeImage} key={asset.id} src={caseApi(data.workspaceId,data.caseId,`assets/${asset.id}${asset.hasPreview?'?preview=1':'?view=1'}`)} alt={asset.name} />
     {writable&&commentMode&&<button className={s.pinSurface} aria-label="Place a comment pin on the image" disabled={busy} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPoint(e.detail===0?{x:0.5,y:0.5}:{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))});setActive(null);setCommentMode(false);composer.current?.focus();}}/>}
     {threads.map((t,i)=>t.anchor&&<button key={t.id} className={s.pin} data-active={active===t.id} style={{left:`${t.anchor.x*100}%`,top:`${t.anchor.y*100}%`}} aria-label={`Comment ${i+1}: ${t.title}`} onClick={()=>{setActive(t.id);document.getElementById(`thread-${t.id}`)?.scrollIntoView({block:'nearest'});}}>{i+1}</button>)}
     {point&&<span className={s.pin} style={{left:`${point.x*100}%`,top:`${point.y*100}%`}}>+</span>}
    </div>:<FileCover data={data} design={{...design,versions:revision?[revision]:[]}} full/>}
   </div></div>
    {writable&&pinnable&&<small className={s.hint}>{commentMode?'Click any point on the image, then write your comment.':'Choose Add comment to pin feedback on the image.'}</small>}
   </div>
   <aside className={s.comments} aria-label="Design comments">
    <h3>Comments <span className={s.count}>({threads.reduce((n,t)=>n+t.messages.length,0)+design.activity.filter(a=>a.action==='comment'&&a.versionId===revision?.id).length})</span></h3>
    {writable?<div className={s.composerRow}><Avatar name={members.find(m=>m.id===options.actorId)?.name??"You"} size="md"/><form className={s.composer} onSubmit={e=>{e.preventDefault();void post();}}>
     {point&&<div className={s.pendingPin}><MapPin size={12}/><span>Image comment</span><button type="button" aria-label="Remove pin" disabled={busy} onClick={()=>setPoint(null)}><X size={12}/></button></div>}
     <textarea ref={composer} aria-label="Comment" placeholder="Write a comment… Type @ to mention" value={body} maxLength={5000} disabled={busy} aria-controls={mentionQuery?'mention-options':undefined} aria-activedescendant={suggestions[highlight]?`mention-${suggestions[highlight].id}`:undefined} onChange={e=>{setBody(e.target.value);detectMention(e.target.value,e.target.selectionStart);}} onClick={e=>detectMention(body,e.currentTarget.selectionStart)} onKeyDown={e=>{if(!mentionQuery)return;if(e.key==='Escape'){e.preventDefault();setMentionQuery(null);}else if(suggestions.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setHighlight(v=>(v+(e.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);}else if(suggestions.length&&e.key==='Enter'){e.preventDefault();selectMention(suggestions[highlight]);}}}/>
     {mentionQuery&&<div id="mention-options" role="listbox" aria-label="Mention people" className={s.mentionMenu}>{suggestions.length?suggestions.map((member,index)=><button type="button" role="option" aria-label={member.name} id={`mention-${member.id}`} aria-selected={index===highlight} key={member.id} onMouseDown={e=>e.preventDefault()} onClick={()=>selectMention(member)}><Avatar name={member.name} size="sm"/><span>{member.name}</span></button>):<small>No matching people</small>}</div>}
     <div className={s.sendRow}><Button type="submit" size="compact" variant="primary" isDisabled={!body.trim()||busy} isLoading={busy} aria-label="Post"><Send size={16}/></Button></div>
    </form></div>:<p className={s.empty}>Comments are locked for this record.</p>}
    <div className={s.list}>
     {!threads.length&&!design.activity.some(a=>a.action==='comment'&&a.versionId===revision?.id)&&<p className={s.empty}>No comments yet.</p>}
     {threads.map((t,i)=><article id={`thread-${t.id}`} key={t.id} data-active={active===t.id} className={s.thread}>
      {t.messages.filter((_,index)=>index===0||expanded.includes(t.id)).map((m,index)=><div key={m.id} className={s.message}>
       <Avatar name={m.createdByName} size="md"/>
       <div className={s.messageBody}><header><strong>{m.createdByName}</strong><time dateTime={m.createdAt}>{date(m.createdAt)}</time>{index===0&&t.anchor&&<button className={s.location} aria-label={`Show pin ${i+1}`} onClick={()=>setActive(t.id)}>#{i+1}</button>}</header><p>{m.body}</p></div>
      </div>)}
      {Boolean(t.mentions?.length)&&<small className={s.mentions}>{t.mentions!.map(userId=>'@'+(members.find(m=>m.id===userId)?.name??'Workspace member')).join(' ')}</small>}
      {writable&&replyTo!==t.id&&<button className={s.replyAction} onClick={()=>{setReplyTo(t.id);setReply('');setReplyId(crypto.randomUUID());}}><MessageCircle size={13}/>Reply</button>}
      {t.messages.length>1&&<button className={s.expandReplies} aria-expanded={expanded.includes(t.id)} onClick={()=>setExpanded(v=>v.includes(t.id)?v.filter(id=>id!==t.id):[...v,t.id])}><ChevronDown size={13}/>{expanded.includes(t.id)?'Hide':'See'} {t.messages.length-1} {t.messages.length===2?'reply':'replies'}</button>}
      {replyTo===t.id&&<form className={s.replyComposer} onSubmit={e=>{e.preventDefault();void postReply(t.id);}}><textarea autoFocus aria-label="Your reply" placeholder="Write a reply…" value={reply} maxLength={5000} disabled={busy} onChange={e=>setReply(e.target.value)}/><div><Button size="compact" variant="quiet" isDisabled={busy} onPress={()=>setReplyTo(null)}>Cancel</Button><Button type="submit" size="compact" variant="primary" isDisabled={busy||!reply.trim()}>Reply</Button></div></form>}
     </article>)}
     {design.activity.filter(a=>a.action==='comment'&&a.versionId===revision?.id).map(a=><article key={a.id} className={s.thread}><header><Avatar name={a.createdByName} size="sm"/><strong>{a.createdByName}</strong></header><p>{a.note}</p></article>)}
    </div>
    {error&&<p role="alert">{error}</p>}
   </aside>
  </div>
 </CaseModal>;
}
