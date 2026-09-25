"use client";
import type {ReactNode} from "react";
import {Badge, Button, DataGrid, type DataGridColumn} from "@/design-system";
import type {ProjectState, Task} from "@/lib/projects/execution";

export function closeoutScopeRows(state: ProjectState) {
 const d=state.data;
 return [...(d.scope?.lines??[]),...(d.variations??[]).flatMap(v=>v.lines)].filter(l=>!l.deductsLineId).map(line=>{
  const tasks=d.tasks.filter(t=>t.status!=="cancelled"&&(t.scopeIds.includes(line.id)||(d.workPackages??[]).some(w=>w.id===t.packageId&&w.scopeLineIds.includes(line.id))));
  const inspections=tasks.filter(t=>t.status==="awaiting_inspection");
  const snags=d.snags.filter(s=>s.status!=="closed"&&(tasks.some(t=>t.id===s.taskId)||(!s.taskId&&s.area===line.room)));
  const incomplete=tasks.filter(t=>t.status!=="completed");
  return {id:line.id,title:line.title,room:line.room,tasks,inspections,snags,incomplete,status:!tasks.length?"Not planned":inspections.length?"Inspection needed":incomplete.length?"Work outstanding":snags.length?"Snags open":"Work complete"};
 });
}
type Row=ReturnType<typeof closeoutScopeRows>[number];
export function CloseoutReadiness({state,search="",toolbarActions,onOpenTask}:{state:ProjectState;search?:string;toolbarActions?:ReactNode;onOpenTask:(task:Task)=>void}) {
 const columns:DataGridColumn<Row>[]=[
  {id:"item",header:"BOQ item",accessorFn:r=>r.title,meta:{primary:true}},
  {id:"room",header:"Room / area",accessorFn:r=>r.room},
  {id:"work",header:"Tasks complete",accessorFn:r=>r.tasks.length-r.incomplete.length,meta:{renderCell:r=>r.tasks.length?`${r.tasks.length-r.incomplete.length} / ${r.tasks.length}`:"Not planned"}},
  {id:"qc",header:"Awaiting inspection",accessorFn:r=>r.inspections.length},
  {id:"snags",header:"Open snags",accessorFn:r=>r.snags.length},
  {id:"status",header:"Readiness",accessorFn:r=>r.status,meta:{renderCell:r=><Badge tone={r.status==="Work complete"?"success":r.status==="Not planned"?"neutral":"warning"}>{r.status}</Badge>}},
  {id:"action",header:"",enableSorting:false,meta:{renderCell:r=>{const task=r.inspections[0]??r.incomplete[0];return task?<Button size="compact" onPress={()=>onOpenTask(task)}>{r.inspections.length?"Inspect work":"Review task"}</Button>:null;}}},
 ];
 return <DataGrid gridLines ariaLabel="BOQ completion checks" columns={columns} data={closeoutScopeRows(state).filter(row=>`${row.title} ${row.room} ${row.status}`.toLowerCase().includes(search.toLowerCase()))} getRowId={r=>r.id} rowNumbers={false} selectable={false} showToolbar toolbarActions={toolbarActions} searchLabel="Search BOQ items" emptyTitle="No approved scope" emptyDescription="Approved BOQ items appear here for completion checks."/>;
}
