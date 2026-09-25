"use client";
import { useState } from "react";
import Link from "next/link";
import { ProjectDeliveryQuantities } from "./project-delivery-quantities";
import { activeReleasedScopeLines } from "../../../../services/business-core/src/projects/project-scope-lines";
import { ArrowRight, Factory, Hammer, Briefcase, CalendarDays, UserRound } from "lucide-react";
import { parseDate } from "@internationalized/date";
import { Badge, Button, ControlledModalDialog, SelectField, DateField, MenuButton, useConfirmationDialog } from "@/design-system";
import { label, type ProjectState, type ProjectWorkPackage, type Task, type Material } from "@/lib/projects/execution";
import { supplyLabels, siteLabels, workOrderDetails } from "@/lib/projects/work-orders";
import { itemDeliveryRoute, itemTaskSuggestions, itemWorkLocations } from "../../../../services/business-core/src/projects/project-item-plan";
import { documentHref } from "./project-stage";
import s from "./project-work-plan-editor.module.css";

const formatDate = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"short", year:"numeric", timeZone:"UTC" }).format(new Date(`${value}T00:00:00Z`)) : "Not scheduled";

type Props = { state: ProjectState; work: ProjectWorkPackage; busy: boolean; error: string; onClose: () => void; initialTab?: string; onHandover?: () => void; onOpenRecord?: (id:string,tab:string) => void; onOpenMaterial?: (material: Material) => void; onOpenTask: (task: Task, tab: string, detail?:"details"|"materials"|"updates") => void; run: (action: string, input: Record<string, unknown>) => Promise<boolean> };
export function ProjectWorkPlanEditor({ state, work, busy, error, onClose, run, onOpenTask, onOpenMaterial, onHandover, onOpenRecord, initialTab = "plan" }: Props) {
  const [quantitiesOpen, setQuantitiesOpen] = useState(false);
  const [plan, setPlan] = useState(work);
  const [savedPlan, setSavedPlan] = useState(work);
  const [notice, setNotice] = useState("");
  const {confirmationDialog, requestConfirmation} = useConfirmationDialog();
  const [tab, setTab] = useState(["factory", "site"].includes(initialTab) ? "execute" : initialTab);
  const [taskLocation] = useState(["factory", "site"].includes(initialTab) ? initialTab : "all");
  const [adding, setAdding] = useState(false);
  const [stepId, setStepId] = useState(() => crypto.randomUUID());
  const [validation, setValidation] = useState("");
  const scopeLines = activeReleasedScopeLines(state.data).filter(line=>work.scopeLineIds.includes(line.id));
  const scopeQuantity = scopeLines.length===1 ? String(scopeLines[0].quantity) : "";
  const scopeUnit = scopeLines.length===1 ? scopeLines[0].unit : "";
  const [step, setStep] = useState({ title: "", location: ["factory", "site"].includes(initialTab) ? initialTab : work.deliveryRoute === "factory" || work.deliveryRoute === "vendor" ? "factory" : work.deliveryRoute === "office" ? "office" : "site", ownerId: work.ownerId || "", start: work.plannedStart || "", end: work.plannedEnd || "", quantity: scopeQuantity, unit: scopeUnit, predecessor: "" });
  const tasks = (state.data.tasks ?? []).filter(task => task.packageId === work.id && task.status !== "cancelled");
  const visibleTasks = tasks.filter(task=>taskLocation==="all" || task.location===taskLocation);
  const details = workOrderDetails(state, work);
  const [materialDraft, setMaterialDraft] = useState<{id:string;title:string;specification:string;required:string;unit:string;supply:string;taskId:string;needBy:string}|null>(null);
  const checks = state.connectedPlan?.packages.find(item=>item.id===work.id)?.readinessIssues ?? [];
  const patch = (key: string, value: string) => setPlan(previous => ({ ...previous, [key]: value }));
  const field = (key: keyof typeof step, value: string) => setStep(previous => ({ ...previous, [key]: value }));
  const dirty = ["supplyMethod","siteWork","workLocation","ownerId","plannedStart","plannedEnd"].some(key => (plan[key as keyof ProjectWorkPackage] ?? "") !== (savedPlan[key as keyof ProjectWorkPackage] ?? ""));
  const leave = (action: () => void) => {
    if (busy) return;
    if (dirty || adding || materialDraft) requestConfirmation({title:"Discard unsaved changes?",body:"Save the draft first to keep your planning changes.",onConfirm:action});
    else action();
  };
  const planInput = () => ({...work, supplyMethod: plan.supplyMethod ?? "", siteWork: plan.siteWork ?? "", workLocation: plan.workLocation ?? "", ownerId: plan.ownerId, plannedStart: plan.plannedStart, plannedEnd: plan.plannedEnd});
  async function saveDraft() {
    setValidation("");
    if (plan.plannedStart && plan.plannedEnd && plan.plannedEnd < plan.plannedStart) { setValidation("Finish must be on or after start."); return; }
    if (await run("work_package", {workPackage: planInput()})) {setSavedPlan(plan);setNotice("Draft saved. This does not release work.");}
  }
  async function save() {
    setValidation("");
    if (tab === "materials" && materialDraft) {
      if (!materialDraft.title.trim() || !materialDraft.taskId || !materialDraft.needBy || !(Number(materialDraft.required)>0)) { setValidation("Enter a requirement, task, quantity and needed-by date."); return; }
      if (await run("material", {material:{...materialDraft,required:Number(materialDraft.required),scopeLineId:work.scopeLineIds.length===1?work.scopeLineIds[0]:"",catalogId:"",catalogVersion:0}})) setMaterialDraft(null);
      return;
    }
    if (tab === "steps" && adding) {
      if (!step.title.trim() || !step.start || !step.end || !(Number(step.quantity) > 0) || !step.unit.trim()) { setValidation("Enter a task name, dates, quantity and unit."); return; }
      if (step.end < step.start) { setValidation("Finish must be on or after start."); return; }
      const route = itemDeliveryRoute(plan);
      const allowed = route === "mixed" || (route === "vendor" ? step.location === "factory" : route === step.location);
      if (!allowed) { setValidation("This location does not match the saved delivery plan. Update the plan first."); return; }
      const saved = await run("task", { task: { ...step, id: stepId, packageId: work.id, package: work.title, area: work.area, scopeIds: work.scopeLineIds, quantity: Number(step.quantity), predecessors: step.predecessor ? [step.predecessor] : [], parentId: "", assigneeIds: [], resourceId: "", weight: 1, priority: "normal", inspectionRequired: true, drawingId: "", readiness: { scope: false, access: false, materials: false } } });
      if (saved) { setStepId(crypto.randomUUID()); setAdding(false); setStep(previous => ({ ...previous, title: "", predecessor: "" })); }
      return;
    }
    if (plan.plannedStart && plan.plannedEnd && plan.plannedEnd < plan.plannedStart) { setValidation("Finish must be on or after start."); return; }
    if (!plan.supplyMethod || !plan.siteWork) { setValidation("Choose how this item is supplied and what happens on-site."); return; }
    if (itemWorkLocations(plan.supplyMethod).length && !plan.workLocation) { setValidation("Choose where the work will happen."); return; }
    if (await run("work_package", { workPackage: planInput() })) {setSavedPlan(plan);setNotice("");setTab(tab === "plan" ? "steps" : "materials");}
  }
  const choose = (name: string, value: string, items: {id: string; label: string}[], change: (value: string) => void) => <SelectField label={name} selectedKey={value || "none"} items={items} isDisabled={busy || !state.canManage} onSelectionChange={key=>change(key === "none" ? "" : String(key))}/>;
  const date = (name: string, value: string, change: (value: string) => void) => <DateField label={name} value={value ? parseDate(value) : null} isDisabled={busy || !state.canManage} onChange={value=>change(value?.toString() ?? "")}/>;
  const suggestions = itemTaskSuggestions(plan).filter(suggestion=>(taskLocation==="all"||suggestion.location===taskLocation)&&!tasks.some(task=>task.title.toLowerCase()===suggestion.title.toLowerCase()));
  const people = [{id:"none",label:"Assign later"}, ...state.members.map(member=>({id:member.id,label:member.name}))];
  const pipeline=[{id:"plan",label:"Supply & site plan"},{id:"steps",label:"Plan work"},{id:"materials",label:"Source materials"},{id:"checks",label:"Start checks"},{id:"execute",label:taskLocation==="factory"?"Factory work":taskLocation==="site"?"Site work":"Work & daily progress"},{id:"quality",label:"Quality check"},{id:"complete",label:"Handover"}];
  const taskIds=new Set(tasks.map(task=>task.id));
  const defects=(state.data.snags??[]).filter(snag=>snag.status!=="closed"&&(taskIds.has(snag.taskId)||(!snag.taskId&&!!work.area&&snag.area===work.area)));
  const handovers=(state.data.handovers??[]).filter(item=>item.sourcePackageId===work.id||item.taskIds.some(id=>taskIds.has(id)));
  const needsQuality=(task:Task)=>task.status==='awaiting_inspection'||task.installationBatches?.some(batch=>['pending_qc','rework'].includes(batch.status));
  const availableBatches=tasks.flatMap(task=>(task.installationBatches??[]).filter(batch=>batch.status==='passed'&&!handovers.some(h=>['draft','ready','accepted'].includes(h.status)&&(h.installationBatchIds?.includes(batch.id)||(!h.installationBatchIds?.length&&h.taskIds.includes(task.id))))));
  const stageIndex=pipeline.findIndex(stage=>stage.id===tab);
  async function continueFlow(){
    if(tab==="plan" || tab==="steps") {
      if(tab==="steps" && !adding && (!plan.ownerId || !tasks.length)){setValidation("Assign the item owner and add at least one task before continuing.");return;}
      await save();return;
    }
    if(tab==="materials" && materialDraft){await save();return;}
    setValidation("");setTab(pipeline[Math.min(stageIndex+1,pipeline.length-1)].id);
  }
  if (quantitiesOpen) return <ProjectDeliveryQuantities state={state} work={work} busy={busy} error={error} run={run} onClose={()=>setQuantitiesOpen(false)}/>;
  return <><ControlledModalDialog isOpen onOpenChange={open=>{if(!open) leave(onClose);}} isDismissable={!busy} title={work.title} description={`BOQ item · ${work.area || "No area"}`} size="md" footer={<div className={s.footer}>
    <Button size="compact" isDisabled={busy} onPress={()=>leave(onClose)}>Close</Button>
    {state.canManage && ["plan","steps"].includes(tab) && !adding && <Button size="compact" isDisabled={busy} onPress={saveDraft}>Save draft</Button>}
    {stageIndex>0&&!adding&&!materialDraft&&<Button size="compact" isDisabled={busy} onPress={()=>{setValidation("");setTab(pipeline[stageIndex-1].id);}}>Back</Button>}
    {stageIndex<pipeline.length-1&&<Button size="compact" variant="primary" isDisabled={busy || ((tab==="plan" || tab==="steps" || !!materialDraft) && !state.canManage)} onPress={continueFlow}>{busy?"Saving…":adding?"Add task":materialDraft?"Save requirement":tab==="plan"?"Save & continue":tab==="steps"?"Save & continue":tab==="execute"?"Review quality":"Continue"}</Button>}
  </div>}>
    <div className={s.editor}>
      {scopeLines.length > 0 && tab === "plan" && <p className={s.hint}>Source BOQ: {scopeLines.map(line=>`${line.title} · ${line.quantity} ${line.unit}`).join("; ")}</p>}
      <h3 className={s.stepTitle}>{pipeline[stageIndex]?.label}</h3>
      {notice && <p role="status" className={s.hint}>{notice}</p>}
      {(validation || error) && <p role="alert" className={s.error}>{validation || error}</p>}
      {tab === "plan" ? <>
        <Button size="compact" onPress={()=>setQuantitiesOpen(true)}>Delivery quantities{work.deliveryQuantities ? ` · ${work.deliveryQuantities.status}` : ""}</Button>
        
        {choose("How will we supply this?",plan.supplyMethod??"",[{id:"none",label:"Choose supply method"},...Object.entries(supplyLabels).map(([id,label])=>({id,label}))],value=>setPlan(previous=>({...previous,supplyMethod:value as ProjectWorkPackage["supplyMethod"],workLocation:undefined})))}
        {itemWorkLocations(plan.supplyMethod).length > 0 && choose("Where will the work happen?",plan.workLocation??"",[{id:"none",label:"Choose work location"},...itemWorkLocations(plan.supplyMethod).map(id=>({id,label:({factory:"Our factory",supplier:"Supplier workshop",site:"On-site",office:"Office / design"})[id]}))],value=>patch("workLocation",value))}
        {choose("What happens on-site?",plan.siteWork==="none"?"no_site":plan.siteWork??"unset",[{id:"unset",label:"Choose site work"},...Object.entries(siteLabels).map(([id,label])=>({id: id==="none"?"no_site":id,label}))],value=>patch("siteWork",value==="no_site"?"none":value==="unset"?"":value))}
      </> : tab === "materials" ? <>
        <p className={s.hint}>Materials for {work.title}. Open a requirement to source or receive it.</p>
        {!materialDraft ? <>
          {details.materials.length ? <div className={s.tableScroll}><table className={s.compactTable}><thead><tr><th>Material / item</th><th>Required</th><th>Supplied by</th><th>Received</th><th>Outstanding</th><th></th></tr></thead><tbody>{details.materials.map(material=>{const received=material.movements.reduce((total,movement)=>total+(movement.kind==="receive"?movement.quantity:["supplier_return","waste","transfer_out"].includes(movement.kind)?-movement.quantity:0),0);const pending=Math.max(0,material.required-received);return <tr key={material.id}><th scope="row">{material.title}</th><td>{material.required} {material.unit}</td><td>{material.supply==="company"?"Our company":material.supply==="client"?"Client":"Supplier"}</td><td>{Math.max(0,received)} {material.unit}</td><td><Badge tone={pending<=0?"success":"warning"}>{pending<=0?"Received":`${pending} ${material.unit} pending`}</Badge></td><td>{onOpenMaterial && <Button size="compact" onPress={()=>leave(()=>onOpenMaterial(material))}>Open material</Button>}</td></tr>;})}</tbody></table></div> : <p className={s.hint}>No materials added.</p>}
          {state.canManage && <Button size="compact" isDisabled={!tasks.length} onPress={()=>setMaterialDraft({id:crypto.randomUUID(),title:"",specification:"",required:"1",unit:"nos",supply:work.supplyMethod==="client"?"client":"company",taskId:tasks.length===1?tasks[0].id:"",needBy:work.plannedStart||""})}>+ Add requirement</Button>}
          {!tasks.length && <p className={s.hint}>Plan a task first so the requirement has a clear destination.</p>}
          {details.orders.length>0 && <div className={s.tableScroll}><table className={s.compactTable} aria-label="Linked procurement"><thead><tr><th>Request / order</th><th>Supplier</th><th>State</th><th>Action</th></tr></thead><tbody>{details.orders.map(order=><tr key={order.id}><th scope="row">{order.number}</th><td>{order.vendor}</td><td>{label(order.status)}</td><td>{onOpenRecord&&<Button size="compact" onPress={()=>leave(()=>onOpenRecord(order.id,'materials'))}>Open {order.status==='enquiry'?'request':'order'}</Button>}</td></tr>)}</tbody></table></div>}
        </> : <div className={s.stepForm}>
          <label className={s.field}>Requirement<input value={materialDraft.title} onChange={event=>setMaterialDraft({...materialDraft,title:event.target.value})} placeholder="e.g. Oak boards, sofa or installation service"/></label>
          <label className={s.field}>Specification<input value={materialDraft.specification} onChange={event=>setMaterialDraft({...materialDraft,specification:event.target.value})}/></label>
          <div className={s.pair}><label className={s.field}>Quantity<input type="number" min="0.001" step="any" value={materialDraft.required} onChange={event=>setMaterialDraft({...materialDraft,required:event.target.value})}/></label><label className={s.field}>Unit<input value={materialDraft.unit} onChange={event=>setMaterialDraft({...materialDraft,unit:event.target.value})}/></label></div>
          {choose("Required for task",materialDraft.taskId,[{id:"none",label:"Choose task"},...tasks.map(task=>({id:task.id,label:task.title}))],value=>setMaterialDraft({...materialDraft,taskId:value}))}
          {choose("Supplied by",materialDraft.supply,[{id:"company",label:"Our company — stock or purchase"},{id:"vendor",label:"Included in supplier scope"},{id:"client",label:"Client supplied"}],value=>setMaterialDraft({...materialDraft,supply:value}))}
          {date("Needed by",materialDraft.needBy,value=>setMaterialDraft({...materialDraft,needBy:value}))}
          <Button size="compact" variant="quiet" onPress={()=>setMaterialDraft(null)}>Cancel requirement</Button>
        </div>}
      </> : tab === "checks" ? <>
        {work.status === "planning" && state.canManage && <Button size="compact" isDisabled={busy} onPress={async()=>{if(await run("work_package", {workPackage:{...work,status:"ready"}})) setTab("execute");}}>Check & release for work</Button>}
        <div className={s.listHeading}><strong>Start checks</strong><Badge tone={state.commercialReady?"success":"warning"}>{state.commercialReady?"Commercially released":"Release pending"}</Badge></div>
        <p className={s.hint}>This delivery plan creates the same tasks used by Factory, Site and Daily progress. Releasing the package makes them eligible to start; task readiness is checked again when work begins.</p>
        {work.status!=="planning"&&<div className={s.handoffLinks}><Link href={`/workspace/projects/${state.id}/production`}>Factory tasks →</Link><Link href={`/workspace/projects/${state.id}/site-work`}>On-site work →</Link><Link href={`/workspace/projects/${state.id}/daily-progress`}>Daily progress →</Link></div>}
        <div className={s.tableScroll}><table className={s.compactTable}><thead><tr><th>Task</th><th>Owner</th><th>Drawing</th><th>Scope</th><th>Access</th><th>Materials</th><th></th></tr></thead><tbody>{tasks.map(task=><tr key={task.id}><th scope="row">{task.title}</th>{[Boolean(task.ownerId),state.data.documents.some(doc=>doc.id===task.drawingId && doc.status==="approved"),task.readiness.scope,task.readiness.access,task.readiness.materials].map((ready,index)=><td key={index}><span className={s.check} data-ready={ready} aria-label={ready?"Confirmed":"Pending"}>{ready?"✓":"Pending"}</span></td>)}<td><Button size="compact" onPress={()=>leave(()=>onOpenTask(task, tab))}>Review</Button></td></tr>)}</tbody></table></div>
        {!tasks.length && <Button size="compact" onPress={()=>{setTab("steps");setAdding(true);}} isDisabled={!state.canManage}>Add first task</Button>}
        <section className={s.checkSection}><h3>Approved drawings · {details.designs.length}</h3><ul className={s.steps}>{details.designs.map(doc=><li key={doc.id}><span>{doc.title} · {doc.revision}</span>{documentHref(state,doc)?<a href={documentHref(state,doc)} target="_blank" rel="noreferrer">View drawing</a>:<span>No file attached</span>}</li>)}</ul></section>
        {checks.length>0 && <section className={s.checkSection}><h3>Other release checks · {checks.length}</h3><ul>{checks.map((check,index)=><li key={index}>{check.detail}</li>)}</ul></section>}
      </> : tab === "quality" ? <>
        {tasks.filter(needsQuality).map(task=><div key={task.id} className={s.listHeading}><span><strong>{task.title}</strong><small> · {task.approved} / {task.quantity} {task.unit} approved</small></span><Button size="compact" onPress={()=>leave(()=>onOpenTask(task,"quality"))}>Inspect work</Button></div>)}
        {defects.map(snag=><div key={snag.id} className={s.listHeading}><span><strong>{snag.title}</strong><small> · {label(snag.status)}</small></span>{onOpenRecord&&<Button size="compact" onPress={()=>onOpenRecord(snag.id,"quality")}>Review defect</Button>}</div>)}
        {!defects.length&&!tasks.some(needsQuality)&&<p className={s.hint}>{tasks.length&&tasks.every(task=>task.status==="completed")?"No open defects or pending task inspections.":"No work awaiting inspection. Complete and submit the work first."}</p>}
      </> : tab === "complete" ? <>
        <strong>{handovers.some(item=>item.status==="accepted")?"Acceptance records":tasks.length && tasks.every(task=>task.status==="completed")?"Work completed · handover pending":"Work still in progress"}</strong>
        <p className={s.hint}>{tasks.filter(task=>task.status==="completed").length} of {tasks.length} tasks completed. Client acceptance is recorded separately from completed work.</p>
        {handovers.map(item=><div key={item.id} className={s.listHeading}><span><strong>{item.title}</strong> · {label(item.status)}</span>{onOpenRecord&&<Button size="compact" onPress={()=>onOpenRecord(item.id,"complete")}>View handover</Button>}</div>)}
        {onHandover && state.canManage && (availableBatches.length>0 || (!handovers.some(item=>["draft","ready","returned"].includes(item.status)) && !(tasks.length>0&&tasks.every(task=>handovers.some(item=>item.status==="accepted"&&!item.installationBatchIds?.length&&item.taskIds.includes(task.id)))))) && <Button size="compact" variant="primary" isDisabled={!tasks.length || (!availableBatches.length&&tasks.some(task=>task.status!=="completed")) || defects.length>0} onPress={()=>leave(onHandover)}>{availableBatches.length?'Prepare partial handover':'Prepare handover'}</Button>}
        {tasks.filter(task=>task.status!=="completed").map(task=><Button key={task.id} size="compact" onPress={()=>onOpenTask(task,"execute")}>Review {task.title}</Button>)}
      </> : <>
        {tab==="execute" && <><div className={s.listHeading}><span>{taskLocation==="factory"?"Build, inspect and dispatch finished items.":"Record work against the assigned tasks."}</span><Button size="compact" onPress={()=>setTab("checks")}>Start checks</Button></div><div className={s.handoffLinks}><Link href={`/workspace/projects/${state.id}/production`}>Factory tasks →</Link><Link href={`/workspace/projects/${state.id}/site-work`}>On-site work →</Link><Link href={`/workspace/projects/${state.id}/daily-progress`}>Daily progress →</Link></div></>}
        {tab==="steps" && !adding && <>
        {choose("Responsible person",plan.ownerId,people,value=>patch("ownerId",value))}
        <div className={s.pair}>{date("Target start",plan.plannedStart,value=>patch("plannedStart",value))}{date("Target finish",plan.plannedEnd,value=>patch("plannedEnd",value))}</div>
        </>}
        {!adding && <>
          <div className={s.listHeading}><strong>{taskLocation==="factory"?"Factory · ":taskLocation==="site"?"On-site · ":""}{visibleTasks.length} {visibleTasks.length===1?"task":"tasks"}</strong>{tab==="steps" && state.canManage && <div className={s.taskToolbar}><Button size="compact" variant="primary" onPress={()=>{setStep(previous=>({...previous,location:itemTaskSuggestions(plan)[0]?.location??previous.location,ownerId:previous.ownerId||plan.ownerId,start:previous.start||plan.plannedStart,end:previous.end||plan.plannedEnd}));setAdding(true);}}>+ Add task</Button></div>}</div>
          {tab==="steps" && state.canManage && !tasks.length && <div className={s.suggestions} role="group" aria-label="Standard plan"><span>Standard plan</span>{([["manufactured","Made in factory"],["ready_made","Ready-made"],["site_work","Site work"],["design","Design"]] as const).map(([template,title])=><Button key={template} size="compact" isDisabled={busy} onPress={()=>void run("package_tasks",{id:work.id,template})}>{title}</Button>)}</div>}
          {tab==="steps" && state.canManage && suggestions.length>0 && <div className={s.suggestions}><span>Quick add</span>{suggestions.map(suggestion=><Button key={suggestion.title} size="compact" onPress={()=>{setStep(previous=>({...previous,title:suggestion.title,location:suggestion.location,ownerId:previous.ownerId||plan.ownerId,start:previous.start||plan.plannedStart,end:previous.end||plan.plannedEnd}));setAdding(true);}}>+ {suggestion.title}</Button>)}</div>}
          {visibleTasks.length ? <ol className={s.taskList}>{visibleTasks.map((task,index)=><li key={task.id}>
            <button type="button" className={s.taskCard} onClick={()=>leave(()=>onOpenTask(task, tab === "execute" ? taskLocation === "all" ? "execute" : taskLocation : taskLocation === "all" ? tab : taskLocation))} aria-label={`Open task: ${task.title}`}>
              <span className={s.cardTop}><span className={s.locationChip}>{task.location==="factory"?<Factory size={14}/>:task.location==="site"?<Hammer size={14}/>:<Briefcase size={14}/>} {task.location==="site"?"On-site":label(task.location)}<span className={s.taskNumber}>Task {index+1}</span></span><span className={s.chip} data-status={task.status}>{label(task.status)}</span></span>
              <span className={s.cardTitle}>{task.title}</span><span className={s.hint}>{task.approved} / {task.quantity} {task.unit} approved</span>
              <span className={s.cardMeta}><span><UserRound size={14} aria-hidden="true"/>{state.members.find(member=>member.id===task.ownerId)?.name || "Unassigned"}</span><span><CalendarDays size={14} aria-hidden="true"/>{formatDate(task.start)} → {formatDate(task.end)}</span></span>
              <span className={s.cardBottom}><span className={s.dependency}>{task.predecessors.length>0?`After ${task.predecessors.map(id=>state.data.tasks.find(previous=>previous.id===id)?.title || "linked task").join(", ")}`:"No preceding task"}</span><span className={s.openTask}>{tab==="execute"&&task.status==="in_progress"?"Daily progress":"Open task"} <ArrowRight size={14} aria-hidden="true"/></span></span>
            </button>
            <MenuButton label={`Task actions for ${task.title}`} items={[{id:'details',label:'Assignment & readiness'},{id:'materials',label:'Materials & stock'},{id:'updates',label:'Progress history'}]} onAction={key=>leave(()=>onOpenTask(task,taskLocation==='all'?tab:taskLocation,String(key) as 'details'|'materials'|'updates'))}/>
          </li>)}</ol> : <p className={s.hint}>No tasks planned. Add a task such as fabrication or installation.</p>}
        </>}
        {adding && <div className={s.stepForm}>
          <div className={s.listHeading}><strong>New task</strong><Button size="compact" variant="quiet" onPress={()=>setAdding(false)}>← Back to tasks</Button></div>
          <label className={s.field}>Task name<input value={step.title} placeholder="e.g. Fabricate kitchen cabinets" onChange={event=>field("title",event.target.value)}/></label>
          <div className={s.pair}>{choose("Location",step.location,[{id:"factory",label:"Factory"},{id:"site",label:"On-site"},{id:"office",label:"Office"}],value=>field("location",value))}{choose("Owner",step.ownerId,people,value=>field("ownerId",value))}</div>
          <div className={s.pair}>{date("Start",step.start,value=>field("start",value))}{date("Finish",step.end,value=>field("end",value))}</div>
          <div className={s.pair}><label className={s.field}>Quantity<input type="number" min="0.001" step="any" value={step.quantity} onChange={event=>field("quantity",event.target.value)}/></label><label className={s.field}>Unit<input value={step.unit} onChange={event=>field("unit",event.target.value)}/></label></div>
          {choose("Wait for task",step.predecessor,[{id:"none",label:"None — can start independently"},...tasks.map(task=>({id:task.id,label:task.title}))],value=>field("predecessor",value))}
          
        </div>}
        
      </>}
    </div>
  </ControlledModalDialog>{confirmationDialog}</>;
}
