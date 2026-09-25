'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,X} from 'lucide-react';
import type {Quote} from '@/lib/commercial/types';
import {roomNames} from '@/lib/commercial/room-builder';
import type {QuotationAnalysis,RoomSuggestion} from '@/lib/commercial/quotation-assist';
import s from './quotation-scope-grid.module.css';
export function QuotationScopeAssistant({quote,workspaceId,caseId,disabled,onClose,onApply}:{quote:Quote;workspaceId:string;caseId:string;disabled:boolean;onClose:()=>void;onApply:(rooms:RoomSuggestion[])=>void}) {
 const [prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[analysis,setAnalysis]=useState<QuotationAnalysis|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function analyze(){if(busy||disabled)return;setBusy(true);setError('');const controller=new AbortController();request.current=controller;
  try{const result=await fetch('/api/quotation-assist',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId,caseId,notes:prompt.trim()||'Review this project’s requirements, item specifications, verified measurements and reference images. Suggest missing quotation items grouped by room, and identify missing materials or measurements. Do not invent quantities, dimensions or prices.',currentRooms:roomNames(quote).map(name=>({name,selected:true,items:quote.lines.filter(line=>line.room===name).map(line=>({title:line.title,workId:line.catalogLinks?.find(link=>link.role==='work')?.recordId,variantId:line.catalogLinks?.find(link=>link.role==='variant')?.recordId}))}))})});const data=await result.json();if(!result.ok)throw new Error(data.message||'Analysis could not complete.');setAnalysis(data);setSelected(new Set(data.rooms.map((room:RoomSuggestion)=>room.id)));}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Analysis could not complete.');}finally{if(!controller.signal.aborted)setBusy(false);}}
 return <aside className={s.assistant} aria-label="Scope assistant">
  <header><strong><Sparkles size={16}/>Scope assistant</strong><button type="button" aria-label="Close scope assistant" onClick={onClose}><X size={16}/></button></header>
  <p>Review requirements, measurements, material specifications and attached references for this project.</p>
  <textarea aria-label="Instructions for scope assistant" maxLength={2000} rows={3} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="For example: check missing joinery items and finishes…" disabled={busy||disabled}/>
  <button type="button" className={s.primary} disabled={busy||disabled} onClick={()=>void analyze()}>{busy?'Analysing project…':'Analyse requirements'}</button>
  {error&&<p role="alert" className={s.error}>{error}</p>}
  {analysis&&<div className={s.results}>
   <p>{analysis.summary}</p><small>{analysis.sources.requirements} requirements · {analysis.sources.measurements} measurements · {analysis.filesAnalyzed} files analysed</small>
   {analysis.rooms.map(room=><section key={room.id}><label className={s.check}><input type="checkbox" checked={selected.has(room.id)} disabled={disabled||busy} onChange={event=>setSelected(value=>{const next=new Set(value);if(event.target.checked)next.add(room.id);else next.delete(room.id);return next;})}/><strong>{room.name}</strong><small>{room.items.length} items</small></label><p>{room.reason}</p>{room.items.map(item=><div className={s.suggestion} key={item.work.id}><strong>{item.work.name}</strong><p>{item.reason}</p>{item.materials.length>0&&<small>{item.materials.map(material=>material.name).join(' · ')}</small>}</div>)}</section>)}
   {(analysis.review.length>0||analysis.notes.length>0)&&<section><strong>Needs your review</strong><ul>{[...analysis.review,...analysis.notes].map((note,index)=><li key={index}>{note}</li>)}</ul></section>}
   <p className={s.help}>Only missing items are added. Confirm quantities, dimensions and rates in the grid.</p>
   <button type="button" className={s.primary} disabled={disabled||busy||!selected.size} onClick={()=>{onApply(analysis.rooms.filter(room=>selected.has(room.id)));setSelected(new Set());}}>Add selected suggestions</button>
  </div>}
 </aside>;
}
