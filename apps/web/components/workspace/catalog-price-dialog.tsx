"use client";
import { parseDate } from "@internationalized/date";
import { useState } from "react";
import { Button, ControlledModalDialog, SelectField, TextInput, NumericInput, DateField, useDesignSystem } from "@/design-system";
import { blankCatalogRecord, catalogStructure, type CatalogRecord } from "@/lib/workspace/catalog";
import { recordCode, recordGroupId, withRecordGroup } from "@/lib/workspace/catalog-navigation";
import { draftFromImportedPrice, importedPrices, priceLabel, recordPrices, sourcePriceBasis } from "@/lib/workspace/catalog-prices";
import { CatalogRecordPicker } from "./catalog-picker";
import styles from "./catalog-settings-page.module.css";

export function CatalogPriceDialog({target,items,canManage,initialSourceKey,onClose,onSave,onSaved,onArchive}:{target:CatalogRecord;items:CatalogRecord[];canManage:boolean;initialSourceKey?:string;onClose:()=>void;onSave:(r:CatalogRecord)=>Promise<CatalogRecord>;onSaved:(r:CatalogRecord)=>void;onArchive:(r:CatalogRecord)=>Promise<CatalogRecord>}) {
  const {timeZone,currency}=useDesignSystem();
  const prices=recordPrices(target,items);
  const sourcePrices=importedPrices(target);
  const blank=()=>{
    const r=withRecordGroup({...blankCatalogRecord("rate_card"),catalogId:target.catalogId,name:`${target.name} price`,configuration:{currency,priceType:"cost",effectiveFrom:new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}},recordGroupId(target)??"");
    r.code=recordCode(r.name,r.id).slice(0,64)+"_"+r.id.slice(0,8).toUpperCase();
    r.links.push({relation:target.kind,targetId:target.id},...target.links.filter(l=>l.relation==="unit"));return r;
  };
  const [draft,setDraft]=useState<CatalogRecord|null>(()=>{const source=sourcePrices.find(p=>p.key===initialSourceKey);return source?draftFromImportedPrice(target,source,items,blank()):target.kind==="rate_card"?structuredClone(target):prices.length?null:blank();});
  const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const config=(key:string,value:string|number)=>setDraft(r=>r?{...r,configuration:{...r.configuration,[key]:value}}:r);
  const setLink=(relation:string,id:string)=>setDraft(r=>r?{...r,links:[...r.links.filter(l=>l.relation!==relation),...(id?[{relation,targetId:id}]:[])]}:r);
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!draft)return;setSaving(true);setError("");try{const saved=await onSave(draft);onSaved(saved);setDraft(null);setMessage("Price saved.");}catch(e){setError(e instanceof Error?e.message:"Could not save price.");}finally{setSaving(false);}};
  return <ControlledModalDialog isOpen onOpenChange={open=>{if(!open&&!saving)onClose();}} isDismissable={!saving} title={`Prices · ${target.name}`} description="Set the amount, unit and what this price includes."
    footer={<div className={styles.footer}><Button isDisabled={saving} onPress={onClose}>Close</Button>{draft&&canManage&&<><Button form="catalog-price-form" type="submit" variant="primary" isLoading={saving}>Save price</Button>{draft.version>0&&<Button isDisabled={saving} onPress={async()=>{setSaving(true);try{onSaved(await onArchive(draft));onClose();}catch(e){setError(e instanceof Error?e.message:"Could not archive.");}finally{setSaving(false);}}}>Archive price</Button>}</>}</div>}>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}
    {sourcePrices.length>0&&<section aria-label="Imported prices" className={styles.importedPrices}>
      <h3>Imported prices · needs review</h3>
      <p>From the workbook. Confirm the unit, tax, inclusions and effective date before saving a price.</p>
      <dl>{sourcePrices.map(price=><div key={price.key}><dt>{price.label}<small className={styles.sourcePriceBasis}>{sourcePriceBasis(price,target)}</small></dt><dd>{price.formatted}{canManage&&<Button size="compact" variant="quiet" isDisabled={saving} onPress={()=>{setDraft(draftFromImportedPrice(target,price,items,blank()));setError('');setMessage('Amount copied. Confirm the price type, unit, tax, inclusions and effective date.');}}>Use amount</Button>}</dd></div>)}</dl>
    </section>}
    {prices.length>0&&<div className={styles.priceList}>{prices.map(rate=><button disabled={!canManage||saving} onClick={()=>{setDraft(structuredClone(rate));setError("");}} key={rate.id}>
      <strong>{priceLabel(rate,items)}</strong><span>{rate.configuration?.supplier||"Internal price"} · {rate.configuration?.effectiveFrom||"No date"}{rate.configuration?.effectiveTo?` to ${rate.configuration.effectiveTo}`:""}</span>
      <small>{rate.configuration?.priceType?`${rate.configuration.priceType} · `:""}{String(rate.configuration?.costIncludes??"Inclusions not set").replaceAll("_"," ")} · Tax {rate.configuration?.taxIncluded==="yes"?"included":"extra"}</small>
    </button>)}</div>}
    {draft&&canManage?<form id="catalog-price-form" className={styles.form} onSubmit={save}><fieldset disabled={saving}><div className={styles.grid}>
      <SelectField label="Price type" isRequired selectedKey={draft.configuration?.priceType?String(draft.configuration.priceType):null} onSelectionChange={k=>k&&config("priceType",String(k))} items={[{id:"purchase",label:"Purchase price"},{id:"cost",label:"Internal cost"},{id:"selling",label:"Selling price"}]}/>
      <NumericInput label="Price per unit" isRequired minValue={0} formatOptions={{maximumFractionDigits:6}} value={draft.configuration?.amount===undefined||draft.configuration.amount===""?NaN:Number(draft.configuration.amount)} onChange={value=>config("amount",Number.isFinite(value)?value:"")}/>
      <SelectField label="Currency" selectedKey={String(draft.configuration?.currency||currency)} onSelectionChange={k=>k&&config("currency",String(k))} items={Array.from(new Set([currency,"INR","AED","USD",String(draft.configuration?.currency||currency)])).map(id=>({id,label:id}))}/>
      <CatalogRecordPicker label="Unit" isRequired selectedKey={draft.links.find(l=>l.relation==="unit")?.targetId??null} onChange={k=>setLink("unit",k)} items={items.filter(r=>r.kind==="unit"&&!r.archived).map(r=>({id:r.id,label:r.name}))}/>
      <div className={styles.full}><TextInput label="Supplier / internal owner" placeholder="Optional" value={String(draft.configuration?.supplier??"")} onChange={value=>config("supplier",value)}/></div>
      <DateField label="Effective from" isRequired value={draft.configuration?.effectiveFrom?parseDate(String(draft.configuration.effectiveFrom)):null} onChange={value=>config("effectiveFrom",value?.toString()??"")}/>
      <DateField label="Effective to · optional" minValue={draft.configuration?.effectiveFrom?parseDate(String(draft.configuration.effectiveFrom)):undefined} value={draft.configuration?.effectiveTo?parseDate(String(draft.configuration.effectiveTo)):null} onChange={value=>config("effectiveTo",value?.toString()??"")}/>
      <SelectField label="Price includes" isRequired selectedKey={String(draft.configuration?.costIncludes||"")} onSelectionChange={k=>k&&config("costIncludes",String(k))} items={catalogStructure.rate_card.fields.find(f=>f.key==="costIncludes")!.options!.filter(id=>id!=="unconfirmed").map(id=>({id,label:id.replaceAll("_"," ")}))}/>
      <SelectField label="Tax included" isRequired selectedKey={String(draft.configuration?.taxIncluded||"")} onSelectionChange={k=>k&&config("taxIncluded",String(k))} items={[{id:"yes",label:"Yes"},{id:"no",label:"No"}]}/>
    </div></fieldset></form>:canManage&&target.kind!=="rate_card"?<Button onPress={()=>{setDraft(blank());setMessage("");}}>Add another price</Button>:!prices.length&&!sourcePrices.length?<p className={styles.muted}>No price recorded yet.</p>:null}
  </ControlledModalDialog>;
}
