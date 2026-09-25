"use client";
import { useState } from "react";
import { SelectField, NumericInput } from "@/design-system";
import type { CatalogRecord } from "@/lib/workspace/catalog";
import { baseUnitNames, convertCatalogQuantity, unitMeaning } from "@/lib/workspace/catalog-units";
import styles from "./catalog-settings-page.module.css";

export function CatalogUnitEditor({draft,onChange,items,disabled}:{draft:CatalogRecord;onChange:(record:CatalogRecord)=>void;items:CatalogRecord[];disabled:boolean}) {
 const used=Boolean(draft.version&&items.some(r=>r.links.some(l=>l.targetId===draft.id)));
 const [compare,setCompare]=useState("");
 const candidates=items.filter(r=>r.kind==="unit"&&!r.archived&&r.id!==draft.id&&r.dimension===draft.dimension&&!['pack','reference'].includes(r.dimension));
 const target=candidates.find(r=>r.id===compare)??candidates[0];
 const converted=target?convertCatalogQuantity(1,draft,target):null;
 return <fieldset><legend>How this unit is measured</legend><p className={styles.muted}>The name is yours. The measurement type and conversion below tell the system what it means.</p>
 <div className={styles.grid}>
 <SelectField label="Measurement type" isDisabled={disabled||used} selectedKey={draft.dimension} onSelectionChange={key=>{if(key)onChange({...draft,dimension:String(key),baseFactor:['pack','reference'].includes(String(key))?undefined:key===draft.dimension?draft.baseFactor:1});}} items={[{id:"length",label:"Length · m, ft, mm"},{id:"area",label:"Area · sq.ft, sq.m"},{id:"volume",label:"Volume · litres, cubic metres"},{id:"mass",label:"Weight · kg, grams"},{id:"count",label:"Count · each, dozen"},{id:"time",label:"Time · hours, days"},{id:"pack",label:"Pack · sheet, box, bundle"},{id:"reference",label:"Technical reference · W, lm, K"}]}/>
 {!['pack','reference'].includes(draft.dimension)&&<NumericInput label={`1 ${draft.name||"unit"} equals`} suffix={baseUnitNames[draft.dimension]} isRequired isDisabled={disabled||used} minValue={0.000000001} formatOptions={{maximumFractionDigits:12,useGrouping:false}} value={draft.baseFactor??NaN} onChange={value=>onChange({...draft,baseFactor:Number.isFinite(value)?value:undefined})}/>}
 </div>
 <p className={styles.measurementMeaning}>{unitMeaning(draft)}</p>
 {used&&<p className={styles.muted}>Already linked to records. You can rename this unit; create a new unit to change its measurement or conversion without changing existing data.</p>}
 {target&&converted!==null&&<div className={styles.conversionPreview}><SelectField label="Check conversion" selectedKey={target.id} onSelectionChange={key=>key&&setCompare(String(key))} items={candidates.map(r=>({id:r.id,label:r.name}))}/><output>1 {draft.name||"unit"} = {Number(converted.toPrecision(10))} {target.name}</output></div>}
 </fieldset>;
}
