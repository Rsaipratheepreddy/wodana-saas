"use client";
import { useEffect,useState } from 'react';
import type { QuoteLine } from '@/lib/commercial/types';
import type { ItemContext } from '@/lib/commercial/item-context';
import { money } from '@/lib/commercial/client';
import { selection } from '@/lib/commercial/room-builder';
import { materialSelections,updateMaterials } from '@/lib/commercial/materials';
import s from './quotation-workbench.module.css';
type Props={item:QuoteLine;onChange:(line:QuoteLine)=>void;workspaceId:string;caseId:string};
export function QuotationItemRecipe(props:Props) { const key=(props.item.catalogLinks??[]).filter(l=>['work','variant'].includes(l.role)).map(l=>l.recordId).join('/'); return <RecipeContents key={key} {...props}/>; }
function RecipeContents({item,onChange,workspaceId,caseId}:Props) {
  const work=item.catalogLinks?.find(c=>c.role==='work')?.recordId,variant=item.catalogLinks?.find(c=>c.role==='variant')?.recordId;
  const [data,setData]=useState<ItemContext|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();if(work){const params=new URLSearchParams({workspaceId,caseId,workId:work,...(variant?{variantId:variant}:{})});fetch(`/api/quotation-assist/item?${params}`,{signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.message);if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message??'Could not load materials.');});}return()=>controller.abort();},[workspaceId,caseId,work,variant,retry]);
  if(!work)return null;
  return <div className={s.recipe}><div className={s.listHeading}><strong>Materials</strong><small>Master Data</small></div>{error?<p className={s.error}>{error} <button className={s.textButton} onClick={()=>{setError('');setData(null);setRetry(retry+1);}}>Retry</button></p>:!data?<p className={s.hint} role="status">Loading linked materials…</p>:<>
    {!!data.prices.length&&<details className={s.coverage}><summary>Reference prices · {data.prices.map(p=>`${money(p.amount,p.currency)} / ${p.basis}`).join(', ')}</summary><p>Source prices may use a different currency, unit, or scope. Set the quoted selling price separately.</p>{data.prices.map((price,i)=><p key={i}>{price.label} · {money(price.amount,price.currency)} / {price.basis}</p>)}</details>}
    {!data.materials.length&&<p className={s.hint}>No linked materials found. Add materials below for this item.</p>}
    {data.materials.map(row=><div className={s.recipeRow} key={row.id}>{row.choices.length!==1&&<div><strong>{row.name}</strong>{row.specification&&<small>{row.specification}</small>}</div>}{row.choices.map(material=>{const role=material.kind==='finish'?'finish':'material',selected=materialSelections(item,role).some(m=>m.recordId===material.id);return <label key={material.id} className={s.recipeToggle}><input type="checkbox" checked={selected} disabled={!selected&&(item.catalogLinks?.length??0)>=12} onChange={()=>onChange(updateMaterials(item,role,selected?materialSelections(item,role).filter(m=>m.recordId!==material.id):[...materialSelections(item,role),selection(role,material)]))}/><span>{material.name}</span></label>;})}{!!row.prices.length&&<small className={s.hint}>{row.prices.map(p=>`${p.label}: ${money(p.amount,p.currency)} / ${p.basis}`).join(' · ')}</small>}{!row.choices.length&&<small className={s.hint}>Choose a material below to match this specification.</small>}</div>)}
  </>}</div>;
}
