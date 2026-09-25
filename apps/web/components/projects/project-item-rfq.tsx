"use client";
import {useEffect,useState} from 'react';
import {parseDate} from '@internationalized/date';
import {Button,Checkbox,ControlledModalDialog,DateField,NumericInput,SearchInput} from '@/design-system';
import type {ProjectState} from '@/lib/projects/execution';
import {materialInventory} from '../../../../services/business-core/src/projects/project-inventory';
import {loadSuppliers,type Supplier} from './project-suppliers';
import s from './project-item-register.module.css';

export function ProjectItemRfq({state,materialIds,busy,error,run,onClose}:{state:ProjectState;materialIds:string[];busy:boolean;error:string;run:(action:string,input:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}){
 const materials=state.data.materials.filter(material=>materialIds.includes(material.id)&&material.supply==='company');
 const [quantities,setQuantities]=useState<Record<string,number>>(()=>Object.fromEntries(materials.map(material=>[material.id,materialInventory(material,state.data.orders,state.stockTransfers??[],state.data.supplierReturns).shortfall])));
 const [chosen,setChosen]=useState<Set<string>>(()=>new Set(materials.filter(material=>materialInventory(material,state.data.orders,state.stockTransfers??[],state.data.supplierReturns).shortfall>0).map(material=>material.id)));
 const [suppliers,setSuppliers]=useState<Supplier[]>([]),[vendors,setVendors]=useState<Set<string>>(new Set()),[query,setQuery]=useState(''),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[attempt,setAttempt]=useState(0);
 const [due,setDue]=useState(''),[delivery,setDelivery]=useState(''),[validation,setValidation]=useState('');
 useEffect(()=>{let active=true;setLoading(true);void loadSuppliers(state.workspaceId).then(rows=>{if(active){setSuppliers(rows.filter(row=>row.status==='active'));setLoadError('');}}).catch(error=>{if(active)setLoadError((error as Error).message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[state.workspaceId,attempt]);
 const toggle=(current:Set<string>,id:string,value:boolean)=>{const next=new Set(current);if(value)next.add(id);else next.delete(id);return next;};
 async function submit(){
  setValidation('');
  if(!chosen.size||chosen.size>100||!vendors.size||vendors.size>25||!due||!delivery||[...chosen].some(id=>!Number.isFinite(quantities[id])||quantities[id]<=0)){setValidation('Select 1–100 requirements, 1–25 suppliers, positive quantities and both dates.');return;}
  if(due>delivery){setValidation('Quotes must be due on or before the required delivery date.');return;}
  if(await run('request_item_quotes',{requirements:[...chosen].map(materialId=>({materialId,quantity:quantities[materialId]})),vendorIds:[...vendors],quoteDueDate:due,promisedDate:delivery}))onClose();
 }
 return <ControlledModalDialog isOpen title="Create RFQs from selected items" size="lg" isDismissable={!busy} onOpenChange={open=>!open&&!busy&&onClose()} footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={!state.canBuy||loading||!!loadError||!chosen.size||!vendors.size} onPress={()=>void submit()}>Create {chosen.size*vendors.size||''} RFQ drafts</Button></div>}>
  <div className={s.form}>
   <p>Review the actual requirements and quantities. Each supplier receives a separate request per requirement. Nothing is sent or ordered by this action.</p>
   {(validation||error||loadError)&&<p role="alert">{validation||error||loadError}</p>}
   {loadError&&<Button size="compact" onPress={()=>setAttempt(value=>value+1)}>Retry suppliers</Button>}
   {!materials.length?<p>No company-purchased requirements for this selection. Plan materials first; client-supplied and supplier-included materials must not be purchased again.</p>:<section aria-label="Requirements to quote">
    <Checkbox isDisabled={busy} isSelected={chosen.size===materials.length} isIndeterminate={chosen.size>0&&chosen.size<materials.length} onChange={checked=>setChosen(checked?new Set(materials.map(material=>material.id)):new Set())}>Select all requirements</Checkbox>
    {materials.map(material=>{const position=materialInventory(material,state.data.orders,state.stockTransfers??[],state.data.supplierReturns);return <div className={s.requirement} key={material.id}><div><Checkbox isDisabled={busy} isSelected={chosen.has(material.id)} onChange={checked=>setChosen(current=>toggle(current,material.id,checked))}>{material.title}</Checkbox><small>Required {material.required} {material.unit} · accepted coverage {position.covered} · incoming {position.incoming} · shortfall {position.shortfall}</small></div><NumericInput label={`Request quantity · ${material.title} (${material.unit})`} minValue={0.001} value={quantities[material.id]} isDisabled={busy||!chosen.has(material.id)} onChange={quantity=>setQuantities(current=>({...current,[material.id]:quantity}))}/></div>;})}
   </section>}
   <div className={s.formRow}><DateField label="Quotes due" value={due?parseDate(due):null} isDisabled={busy} onChange={value=>setDue(value?.toString()??'')}/><DateField label="Required delivery" value={delivery?parseDate(delivery):null} isDisabled={busy} onChange={value=>setDelivery(value?.toString()??'')}/></div>
   <SearchInput label="Find suppliers" value={query} onChange={setQuery}/>
   <div className={s.supplierList} role="group" aria-label="Selected suppliers">{loading?<p role="status">Loading suppliers…</p>:suppliers.filter(supplier=>`${supplier.displayName} ${supplier.code}`.toLowerCase().includes(query.toLowerCase())).map(supplier=><Checkbox key={supplier.id} isSelected={vendors.has(supplier.id)} isDisabled={busy||!vendors.has(supplier.id)&&vendors.size>=25} onChange={checked=>setVendors(current=>toggle(current,supplier.id,checked))}>{supplier.displayName}</Checkbox>)}{!loading&&!suppliers.length&&!loadError&&<p>No active suppliers. Add and activate suppliers in the supplier directory before requesting quotes.</p>}</div>
   <p>{chosen.size} requirements × {vendors.size} suppliers. Existing open RFQs for the same requirement/supplier must be resolved first. The entire selection saves together.</p>
  </div>
 </ControlledModalDialog>;
}
