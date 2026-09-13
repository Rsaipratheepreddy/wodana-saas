"use client";
import { useState } from 'react';
import { Check, Minus, Pencil, Plus, Search, X } from 'lucide-react';
import type { QuoteLine } from '@/lib/commercial/types';
import { quotationItemName, quotationVariantName } from '@/lib/commercial/presentation';
import type { CommercialCatalogChoice } from './catalog-picker';
import { useCatalogOptions } from './catalog-options-cache';
import s from './quotation-workbench.module.css';

function VariantOptions({options,work,roomName,value,onChange}:{options:CommercialCatalogChoice[];work:CommercialCatalogChoice;roomName:string;value:CommercialCatalogChoice|null;onChange:(variant:CommercialCatalogChoice)=>void}) {
  if(options.length>5)return <select aria-label={`Variant for ${quotationItemName(work.name,roomName)}`} value={value?.id??''} onChange={e=>{const selected=options.find(v=>v.id===e.target.value);if(selected)onChange(selected);}}>{!value&&<option value="" disabled>Select variant</option>}{options.map(v=><option key={v.id} value={v.id}>{quotationVariantName(v.name,work.name,roomName,v.code)}</option>)}</select>;
  return <div>{options.map(variant=><button key={variant.id} className={s.variantChip} aria-pressed={value?.id===variant.id} title={variant.name} onClick={()=>onChange(variant)}>{quotationVariantName(variant.name,work.name,roomName,variant.code)}</button>)}</div>;
}
export function QuotationVariantChoices({workspaceId,caseId,work,roomName='',value,onChange}:{workspaceId:string;caseId:string;work:CommercialCatalogChoice;roomName?:string;value:CommercialCatalogChoice|null;onChange:(variant:CommercialCatalogChoice|null)=>void}) {
  const {items,loading,error,refresh}=useCatalogOptions(workspaceId,caseId,'variant','',work.id,work.catalogId);
  const options=value&&!items.some(item=>item.id===value.id)?[value,...items]:items;
  if(!loading&&!error&&!options.length)return null;
  return <div className={s.variantOptions} role="group" aria-label="Variant"><span>Variant</span><VariantOptions options={options} work={work} roomName={roomName} value={value} onChange={onChange}/>{loading&&<small role="status">Loading variants…</small>}{error&&<p role="alert" className={s.error}>{error} <button className={s.textButton} onClick={refresh}>Retry</button></p>}</div>;
}

function Product({work,roomName,lines,workspaceId,caseId,atLimit,onAdd,onEdit,onQuantity}:{work:CommercialCatalogChoice;roomName:string;lines:QuoteLine[];workspaceId:string;caseId:string;atLimit:boolean;onAdd:(work:CommercialCatalogChoice,variant:CommercialCatalogChoice|null)=>void;onEdit:(id:string)=>void;onQuantity:(id:string,quantity:number)=>void}) {
  const [variantId,setVariantId]=useState<string|null>(null);
  const {items:variants,loading,error,refresh}=useCatalogOptions(workspaceId,caseId,'variant','',work.id,work.catalogId);
  // A visible default makes a new product a single-click add. Existing quotation lines are never rewritten.
  const variant=variants.find(v=>v.id===variantId)??variants[0]??null;
  const added=lines.filter(line=>line.catalogLinks?.some(link=>link.role==='work'&&link.recordId===work.id));
  const matching=added.find(line=>line.catalogLinks?.find(link=>link.role==='variant')?.recordId===variant?.id);
  const name=quotationItemName(work.name,roomName),ready=!loading&&!error;
  return <section className={s.shopProduct} aria-label={name}>
    <div className={s.shopProductHeading}><strong>{name}</strong>{matching?<div className={s.quantityStepper} aria-label={`Quantity for ${name}`}><button aria-label={`Decrease ${name}`} onClick={()=>onQuantity(matching.id,Math.max(0,matching.quantity-1))}><Minus size={13}/></button><span aria-live="polite">{matching.quantity}</span><button aria-label={`Add ${name}`} disabled={!ready||matching.quantity>=1e6} onClick={()=>onAdd(work,variant)}><Plus size={13}/></button></div>:<button className={s.primary} disabled={!ready||atLimit} aria-label={`Add ${name}`} onClick={()=>onAdd(work,variant)}><Plus size={13}/>Add</button>}</div>
    {!!variants.length&&<div className={s.variantOptions} role="group" aria-label={`Variant for ${name}`}><VariantOptions options={variants} work={work} roomName={roomName} value={variant} onChange={v=>setVariantId(v.id)}/></div>}
    {loading&&<small className={s.hint} role="status">Loading variants…</small>}{error&&<p role="alert" className={s.error}>{error} <button className={s.textButton} onClick={refresh}>Retry</button></p>}
    {!!added.length&&<div className={s.productMeta}><span><Check size={12}/>{added.reduce((sum,line)=>sum+line.quantity,0)} in room</span><button className={s.textButton} onClick={()=>onEdit((matching??added[0]).id)} aria-label={`Edit ${name}`}><Pencil size={12}/>Materials & price</button></div>}
  </section>;
}

export function QuotationProductPicker({workspaceId,caseId,catalogId,room,lines,atLimit,onAdd,onCustom,onEdit,onQuantity}:{workspaceId:string;caseId:string;catalogId?:string;room:CommercialCatalogChoice|null;lines:QuoteLine[];atLimit:boolean;onAdd:(work:CommercialCatalogChoice,variant:CommercialCatalogChoice|null)=>void;onCustom:()=>void;onEdit:(id:string)=>void;onQuantity:(id:string,quantity:number)=>void}) {
  const [search,setSearch]=useState(''),[allRooms,setAllRooms]=useState(false);
  const {items,loading,error,refresh}=useCatalogOptions(workspaceId,caseId,'work',search,allRooms?undefined:room?.id,catalogId);
  return <div className={s.productPicker}><div className={s.shopSearch}><label className={s.compactSearch}><Search size={14}/><input type="search" aria-label="Search products" placeholder="Search items…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Clear product search" onClick={()=>setSearch('')}><X size={13}/></button>}</label><button className={s.textButton} disabled={atLimit} onClick={onCustom}><Plus size={13}/>Custom item</button></div>
    {room&&<div className={s.productFilters} role="group" aria-label="Item source"><button aria-pressed={!allRooms} onClick={()=>setAllRooms(false)}>{room.name}</button><button aria-pressed={allRooms} onClick={()=>setAllRooms(true)}>All items</button></div>}
    {error&&<p role="alert" className={s.error}>{error} <button className={s.textButton} onClick={refresh}>Retry</button></p>}{loading&&<p role="status" className={s.hint}>Finding items…</p>}
    {!loading&&!error&&!items.length&&<p className={s.hint}>No matching items. Try another search or add a custom item.</p>}
    <div className={s.products}>{items.map(work=><Product key={work.id} work={work} roomName={room?.name??''} workspaceId={workspaceId} caseId={caseId} lines={lines} atLimit={atLimit} onAdd={onAdd} onEdit={onEdit} onQuantity={onQuantity}/>)}</div>
  </div>;
}
