"use client";
import {SupplierImportDialog} from "./supplier-import-dialog";
import {useState,useEffect,useCallback,useRef} from 'react';
import {Button,ControlledModalDialog,DataGrid,TextInput,SelectField,MultiSelectField,DateField,NumericInput,Checkbox} from '@/design-system';
import {parseDate} from '@internationalized/date';
import {jsonRequest} from '@/lib/commercial/client';
import type {ProjectState,Material} from '@/lib/projects/execution';
import {quantityToSource} from '@/lib/projects/purchasing';
import styles from './project-suppliers.module.css';
export type Supplier={id:string;displayName:string;code:string;status:string;version:number;capabilities:string[];sites?:{id:string;name:string;siteType:string;phone:string|null;email:string|null;contactName:string|null;version:number;status:string;isPrimary:boolean}[]};
export const supplierPath=(w:string,path='')=>`/api/workspace/vendors${path?'/'+path:''}?workspaceId=${w}`;
export async function loadSuppliers(w:string) {const data:Supplier[]=[];let cursor:string|null=null;do{const page: {data:Supplier[];nextCursor:string|null}=await jsonRequest(supplierPath(w)+(cursor?'&cursor='+encodeURIComponent(cursor):''));data.push(...page.data);cursor=page.nextCursor;}while(cursor);return data;}
export function ProjectSuppliers({workspaceId,onChange}:{workspaceId:string;onChange?:()=>void}) {
 const [rows,setRows]=useState<Supplier[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Supplier|null>(null),[form,setForm]=useState({name:'',contact:'',phone:'',email:'',capability:'materials'});
 const newSiteId=useRef('');
 const [importing,setImporting]=useState(false),[importMessage,setImportMessage]=useState('');
 const refresh=useCallback(async()=>{try{setRows(await loadSuppliers(workspaceId));}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[workspaceId]);useEffect(()=>{void refresh();},[refresh]);
 async function edit(row?:Supplier){setError('');try{const detail=row?await jsonRequest<Supplier>(supplierPath(workspaceId,row.id)):{id:crypto.randomUUID(),displayName:'',code:'',status:'draft',version:0,capabilities:['materials'],sites:[]};const site=detail.sites?.find(s=>s.isPrimary&&s.status==='active')??detail.sites?.find(s=>s.status==='active');newSiteId.current=crypto.randomUUID();setForm({name:detail.displayName,contact:site?.contactName??'',phone:site?.phone??'',email:site?.email??'',capability:detail.capabilities[0]??'materials'});setEditing(detail);}catch(e){setError((e as Error).message);}}
 async function save(){if(!editing)return;setBusy(true);setError('');try{
  let saved=await jsonRequest<Supplier>(supplierPath(workspaceId,editing.version?editing.id:''),editing.version?'PATCH':'POST',{...(editing.version?{}:{id:editing.id}),version:editing.version,displayName:form.name.trim(),capabilities:[...new Set([form.capability,...editing.capabilities])]});setEditing(saved);
  const site=saved.sites?.find(s=>s.isPrimary&&s.status==='active')??saved.sites?.find(s=>s.status==='active');
  if(site||form.contact||form.phone||form.email){saved=await jsonRequest<Supplier>(supplierPath(workspaceId,`${saved.id}/sites${site?'/'+site.id:''}`),site?'PATCH':'POST',{...(site?{}:{id:newSiteId.current}),version:site?.version??0,name:site?.name??'Main contact',siteType:site?.siteType??'office',contactName:form.contact||null,phone:form.phone||null,email:form.email||null,isPrimary:true});setEditing(saved);}
  setEditing(null);await refresh();onChange?.();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <>{importing&&<SupplierImportDialog workspaceId={workspaceId} onClose={()=>setImporting(false)} onImported={(created,skipped)=>{setImportMessage(`${created} suppliers imported as drafts. ${skipped} existing suppliers kept.`);void refresh();onChange?.();}}/>}{importMessage&&<p role="status" className={styles.note}>{importMessage}</p>}<p className={styles.note}>Shared supplier directory · available across all projects.</p>{error&&<p role="alert" className={styles.error}>{error}</p>}<DataGrid gridLines isLoading={loading} ariaLabel="Suppliers" persistKey="project-suppliers" data={rows} getRowId={r=>r.id} onRowAction={r=>void edit(r)} columns={[{accessorKey:'displayName',header:'Supplier',meta:{primary:true}},{accessorKey:'code',header:'Code'},{accessorKey:'status',header:'Status'},{id:'actions',header:'',meta:{renderCell:r=><span data-grid-interactive><Button size="compact" onPress={()=>void edit(r)}>Edit</Button>{r.status==='draft'&&<Button size="compact" isDisabled={busy} onPress={()=>void(async()=>{setBusy(true);try{await jsonRequest(supplierPath(workspaceId,r.id+'/lifecycle'),'POST',{version:r.version,action:'activate'});await refresh();onChange?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}})()}>Activate</Button>}</span>}}]} toolbarActions={<><a className="wd-button" href="/templates/suppliers-sample.xlsx" download>Sample Excel</a><Button size="compact" onPress={()=>setImporting(true)}>Import Excel</Button><Button variant="primary" size="compact" onPress={()=>void edit()}>+ Add supplier</Button></>} emptyTitle="No suppliers yet" emptyDescription="Add your existing suppliers, then activate them to request prices."/>
 <ControlledModalDialog isOpen={!!editing} onOpenChange={v=>{if(!v&&!busy)setEditing(null);}} title={editing?.version?'Edit supplier':'Add supplier'} size="md" footer={<div className={styles.actions}><Button isDisabled={busy} onPress={()=>setEditing(null)}>Cancel</Button><Button type="submit" form="supplier-editor" variant="primary" isLoading={busy}>Save supplier</Button></div>}><form id="supplier-editor" className={styles.form} onSubmit={e=>{e.preventDefault();void save();}}>{error&&<p role="alert">{error}</p>}<TextInput label="Supplier name" isRequired value={form.name} onChange={name=>setForm({...form,name})}/><SelectField label="Supplies" items={['materials','services','subcontracting','manufacturing','logistics','other'].map(id=>({id,label:id[0].toUpperCase()+id.slice(1)}))} selectedKey={form.capability} onSelectionChange={k=>setForm({...form,capability:String(k)})}/><TextInput label="Contact person" value={form.contact} onChange={contact=>setForm({...form,contact})}/><div className={styles.row}><TextInput label="WhatsApp / phone" placeholder="+971…" value={form.phone} onChange={phone=>setForm({...form,phone})}/><TextInput label="Email" type="email" value={form.email} onChange={email=>setForm({...form,email})}/></div><p className={styles.note}>New suppliers are saved as drafts. Activate after reviewing their details.</p></form></ControlledModalDialog></>;
}
export function SupplierQuoteRequest({state,source,onClose,onAddRequirement,onCreated,run}:{state:ProjectState;source?:Material;onClose:()=>void;onSuppliers?:()=>void;onAddRequirement?:()=>void;onCreated:()=>void;run:(a:string,b:Record<string,unknown>)=>Promise<boolean>}){
 const [suppliers,setSuppliers]=useState<Supplier[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[directory,setDirectory]=useState(false),[query,setQuery]=useState('');
 const [materialId,setMaterialId]=useState(source?.id??''),[selected,setSelected]=useState<Set<string>>(new Set()),[quantity,setQuantity]=useState(source?quantityToSource(source,state.data.orders,state.stockTransfers,state.data.supplierReturns):NaN),[due,setDue]=useState(''),[delivery,setDelivery]=useState(source?.needBy??'');
 const refresh=useCallback(async()=>{setLoading(true);try{setSuppliers((await loadSuppliers(state.workspaceId)).filter(s=>s.status==='active'));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[state.workspaceId]);
 useEffect(()=>{void refresh();},[refresh]);
 const materials=state.data.materials.filter(m=>m.supply==='company');
 const material=materials.find(m=>m.id===materialId)??(source?.id===materialId?source:undefined);
 const scope=[...(state.data.scope?.lines??[]),...(state.data.variations??[]).flatMap(v=>v.lines)].find(l=>l.id===material?.scopeLineId);
 const visible=suppliers.filter(s=>`${s.displayName} ${s.code}`.toLowerCase().includes(query.toLowerCase()));
 return <ControlledModalDialog isOpen onOpenChange={v=>{if(!v&&!saving)onClose();}} title={directory?"Supplier directory":"Request supplier quotes"} size={directory?"lg":"md"} footer={<div className={styles.actions}>{directory?<Button onPress={()=>{setDirectory(false);void refresh();}}>Back to request</Button>:<><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button variant="primary" type="submit" form="supplier-rfq" isLoading={saving} isDisabled={loading||!material||!selected.size||selected.size>25||!(quantity>0)||!due||!delivery}>Create {selected.size||''} request{selected.size===1?'':'s'}</Button></>}</div>}>
 {directory?<ProjectSuppliers workspaceId={state.workspaceId} onChange={()=>void refresh()}/>:<form id="supplier-rfq" className={styles.form} onSubmit={e=>{e.preventDefault();void(async()=>{setSaving(true);try{if(await run('request_supplier_quotes',{materialId,vendorIds:[...selected],quantity,quoteDueDate:due,promisedDate:delivery})){onCreated();onClose();}else setError('Could not create requests. Review the project error and retry.');}finally{setSaving(false);}})();}}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 {materials.length?<SelectField label="Requirement to quote" isRequired items={materials.map(m=>({id:m.id,label:m.title}))} selectedKey={materialId||null} onSelectionChange={k=>{const m=materials.find(m=>m.id===k);setMaterialId(String(k??''));if(m){setQuantity(quantityToSource(m,state.data.orders,state.stockTransfers,state.data.supplierReturns));setDelivery(m.needBy);}}}/>:<p className={styles.note}>No purchase requirements yet. Start with an approved BOQ item.</p>}
 {onAddRequirement&&<Button size="compact" onPress={onAddRequirement}>+ Add requirement from BOQ</Button>}
 {material&&<>
 <div className={styles.requestItem}><strong>{material.title}</strong><p className={styles.note}>{material.specification}</p>{scope&&<p className={styles.note}>{scope.room} · {scope.title}</p>}</div>
 <div className={styles.row}><NumericInput label={`Quantity per supplier (${material.unit})`} isRequired minValue={0.001} value={quantity} onChange={setQuantity}/><DateField label="Required delivery" isRequired value={delivery?parseDate(delivery):null} onChange={v=>setDelivery(v?.toString()??'')}/></div>
 <div className={styles.supplierHeading}><strong>Suppliers · {selected.size} selected</strong><Button size="compact" onPress={()=>setDirectory(true)}>Add / manage suppliers</Button></div>
 {loading?<p role="status" className={styles.note}>Loading suppliers…</p>:!suppliers.length?<p className={styles.note}>Add or activate a supplier to request their price.</p>:<>
 <TextInput label="Find suppliers" value={query} onChange={setQuery}/>
 <div className={styles.supplierList} role="group" aria-label="Suppliers receiving this request">{visible.map(supplier=><Checkbox key={supplier.id} isSelected={selected.has(supplier.id)} isDisabled={saving||(!selected.has(supplier.id)&&selected.size>=25)} onChange={checked=>setSelected(current=>{const next=new Set(current);if(checked)next.add(supplier.id);else next.delete(supplier.id);return next;})}>{supplier.displayName} · {supplier.code}</Checkbox>)}{!visible.length&&<p className={styles.note}>No suppliers match your search.</p>}</div>
 <p className={styles.note}>Each selected supplier receives the same specification and quantity for comparison.</p>
 </>}
 <DateField label="Quotes due" isRequired value={due?parseDate(due):null} onChange={v=>setDue(v?.toString()??'')}/>
 {selected.size>0&&<p className={styles.note}>Create {selected.size} separate requests, then share each supplier’s private link. Creating requests does not send WhatsApp messages.</p>}
 </>}
 </form>}
 </ControlledModalDialog>;
}

export function SupplierWhatsAppLink({order,url}:{order?:import('@/lib/projects/execution').Order;url:string}) {
 const phone=order?.vendorPhone?.replace(/[\s()-]/g,'')??'';
 const host=new URL(url).hostname;
 const publicLink=!['localhost','127.0.0.1','[::1]'].includes(host)&&!host.endsWith('.local')&&!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
 const validPhone=/^\+[1-9]\d{7,14}$/.test(phone);
 if(!publicLink)return <p className={styles.note}>WhatsApp sharing needs a public app address. This local link will not open on the supplier’s phone.</p>;
 if(!validPhone)return <p className={styles.note}>Add the supplier’s phone with country code (for example +971…) in Suppliers before creating a request. You can still copy this link.</p>;
 const message=`Hello ${order?.vendor}, please quote for ${order?.title}: ${order?.quantity} ${order?.unit}. Required delivery: ${order?.promisedDate}.${order?.quoteDueDate?' Please respond by '+order.quoteDueDate+'.':''} Submit your price and details here: ${url}`;
 return <a className="wd-button" href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Open WhatsApp ↗</a>;
}
