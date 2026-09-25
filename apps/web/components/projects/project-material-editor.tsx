"use client";
import {useState} from "react";
import {parseDate} from "@internationalized/date";
import {Button,ControlledModalDialog,SelectField,TextInput,TextAreaField,NumericInput,DateField} from "@/design-system";
import type {Material,ProjectState} from "@/lib/projects/execution";
import s from "./project-suppliers.module.css";

export function ProjectMaterialEditor({state,onClose,onSaved,run}:{state:ProjectState;onClose:()=>void;onSaved:(material:Material)=>void;run:(action:string,input:Record<string,unknown>)=>Promise<boolean>}) {
 const lines=[...(state.data.scope?.lines??[]),...(state.data.variations??[]).flatMap(v=>v.lines)].filter(l=>!l.deductsLineId);
 const [scopeId,setScopeId]=useState(""),[mode,setMode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [form,setForm]=useState({title:"",specification:"",required:NaN,unit:"",taskId:"",needBy:"",supply:"company"});
 const line=lines.find(l=>l.id===scopeId);
 const tasks=state.data.tasks.filter(t=>t.status!=="cancelled"&&(t.scopeIds.includes(scopeId)||state.data.workPackages?.some(w=>w.id===t.packageId&&w.scopeLineIds.includes(scopeId))));
 const patch=(key:string,value:unknown)=>setForm(previous=>({...previous,[key]:value}));
 function chooseMode(value:string){setMode(value);setForm({title:value==="finished"?line?.title??"":"",specification:value==="finished"?line?.specification||line?.material||line?.title||"":"",required:value==="finished"?line?.quantity??NaN:NaN,unit:value==="finished"?line?.unit??"":"",taskId:tasks.length===1?tasks[0].id:"",needBy:tasks.length===1?tasks[0].start:"",supply:"company"});}
 async function save(){
  if(!line||!mode||!form.title.trim()||!(form.required>0)||!form.unit.trim()||!form.needBy){setError("Complete the item, quantity, unit and needed-by date.");return;}
  setBusy(true);setError("");
  const material={...form,id:crypto.randomUUID(),scopeLineId:line.id,catalogId:"",catalogVersion:0,movements:[]} as Material;
  try{if(await run("material",{material})){onSaved(material);}else setError("Requirement was not saved. Check the project error and retry.");}finally{setBusy(false);}
 }
 return <ControlledModalDialog isOpen onOpenChange={open=>{if(!open&&!busy)onClose();}} title="Add BOQ requirement" size="md" isDismissable={!busy} footer={<div className={s.actions}><Button isDisabled={busy} onPress={onClose}>Cancel</Button><Button type="submit" form="boq-requirement" variant="primary" isLoading={busy} isDisabled={!line||!mode}>Add requirement</Button></div>}>
  <form id="boq-requirement" className={s.form} onSubmit={e=>{e.preventDefault();void save();}}>
   {error&&<p role="alert" className={s.error}>{error}</p>}
   <SelectField label="Approved BOQ item" isRequired isDisabled={busy} items={lines.map(l=>({id:l.id,label:`${l.room||"General"} · ${l.title}`}))} selectedKey={scopeId||null} onSelectionChange={key=>{setScopeId(String(key??""));setMode("");setError("");}}/>
   {!lines.length?<p className={s.note}>Release the approved quotation before adding requirements.</p>:!line?<p className={s.note}>Choose the approved item this requirement belongs to.</p>:<>
    <p className={s.note}>BOQ: {line.quantity} {line.unit} · {line.specification||line.material||line.title}</p>
    <SelectField label="What do you need to source?" isRequired isDisabled={busy} items={[{id:"finished",label:"The finished BOQ item"},{id:"component",label:"Materials to make this item"}]} selectedKey={mode||null} onSelectionChange={key=>chooseMode(String(key))}/>
    {mode&&<>
     {mode==="component"&&<p className={s.note}>Enter the material quantity from the approved drawing or material list, for example 12 sheets for 2 wardrobes.</p>}
     <TextInput label={mode==="finished"?"Item":"Material"} isRequired isReadOnly={mode==="finished"} value={form.title} onChange={v=>patch("title",v)}/>
     <TextAreaField label="Specification" value={form.specification} onChange={v=>patch("specification",v)}/>
     <div className={s.row}><NumericInput label="Required quantity" isRequired minValue={0.001} value={form.required} onChange={v=>patch("required",v)}/><TextInput label="Unit" isRequired value={form.unit} onChange={v=>patch("unit",v)}/></div>
     <SelectField label="Supplied by" isRequired items={[{id:"company",label:"Our company — stock or purchase"},{id:"client",label:"Client"},{id:"vendor",label:"Included in supplier scope"}]} selectedKey={form.supply} onSelectionChange={v=>patch("supply",String(v))}/>
     {tasks.length?<SelectField label="Required for task" items={[{id:"later",label:"Assign during execution planning"},...tasks.map(t=>({id:t.id,label:`${t.location==="factory"?"Factory":t.location==="site"?"On-site":"Office"} · ${t.title}`}))]} selectedKey={form.taskId||"later"} onSelectionChange={v=>{patch("taskId",v==="later"?"":String(v));const task=tasks.find(t=>t.id===v);if(task&&!form.needBy)patch("needBy",task.start);}}/>:<p className={s.note}>Linked to {line.room||"General"} · {line.title}. Assign a task when execution is planned.</p>}
     <DateField label="Needed by" isRequired value={form.needBy?parseDate(form.needBy):null} onChange={v=>patch("needBy",v?.toString()??"")}/>
    </>}
   </>}
  </form>
 </ControlledModalDialog>;
}
