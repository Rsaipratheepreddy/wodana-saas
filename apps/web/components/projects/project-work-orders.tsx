"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Button, DataGrid, EmptyState, IconMenuButton, type DataGridColumn } from "@/design-system";
import { projectActionRoute, type ProjectState, type ProjectWorkPackage } from "@/lib/projects/execution";
import { siteLabels, supplyLabels, workOrderDetails } from "@/lib/projects/work-orders";
import { itemPipelineStages, projectItemPipeline } from "../../../../services/business-core/src/projects/project-item-pipeline";
import s from "./project-items.module.css";

export function ProjectWorkOrders({ state, search = "", location, packageId, onOpen }: {
  state: ProjectState; search?: string; location?: "factory" | "site"; packageId?: string | null;
  onOpen: (work: ProjectWorkPackage, tab?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const items = (state.data.workPackages ?? []).filter(work => work.status !== "cancelled");
  // Compatibility during rolling local/server upgrades uses the same domain read model.
  const pipeline = state.itemPipeline ?? projectItemPipeline(state.data, state.today ?? "");
  const byId = new Map(pipeline.map(item => [item.id, item]));
  const attention = (state.pulse?.nextActions ?? []).filter(action => !items.some(item => item.id === action.recordId));
  const canAct = state.canManage || state.canReport || state.canBuy;
  const open = (work: ProjectWorkPackage) => onOpen(work, byId.get(work.id)?.target ?? "plan");
  const locationLabels = { factory: "Our factory", supplier: "Supplier workshop", site: "On-site", office: "Office / design" };
  const rows = items.filter(work => {
    const current = byId.get(work.id);
    return (!packageId || work.id === packageId)
      && (!location || workOrderDetails(state, work).tasks.some(task => task.location === location))
      && (view === "all" || (view === "attention" ? current?.blocked || current?.overdue : current?.stage === "done"))
      && `${work.title} ${work.area} ${state.members.find(member => member.id === work.ownerId)?.name ?? ""}`.toLowerCase().includes((search || query).trim().toLowerCase());
  });
  const columns: DataGridColumn<ProjectWorkPackage>[] = [
    { accessorKey: "title", header: "Item", size: 250, meta: { primary: true } },
    { accessorKey: "area", header: "Room / area", size: 150, cell: ({ row }) => row.original.area || "Unassigned" },
    { id: "classification", header: "Delivery plan", size: 250, accessorFn: work => {
      if (!work.supplyMethod || !work.siteWork) return "Not classified";
      const source = work.supplyMethod === "make" || work.supplyMethod === "subcontract"
        ? `${supplyLabels[work.supplyMethod]} · ${work.workLocation ? locationLabels[work.workLocation] : "Review location"}`
        : supplyLabels[work.supplyMethod];
      return `${source} · ${siteLabels[work.siteWork]}`;
    } },
    { id: "stage", header: "Stage", size: 150, accessorFn: work => {
      const current = byId.get(work.id);
      return !current ? "Review item" : current.blocked ? "Blocked" : current.overdue ? "Delayed" : itemPipelineStages.find(stage => stage.id === current.stage)?.label ?? "Review item";
    }, cell: ({ row, getValue }) => {
      const current = byId.get(row.original.id);
      return <Badge tone={current?.blocked ? "danger" : current?.overdue ? "warning" : current?.stage === "done" ? "success" : "neutral"}>{String(getValue())}</Badge>;
    } },
    { id: "owner", header: "Owner", size: 160, accessorFn: work => state.members.find(member => member.id === work.ownerId)?.name ?? "Unassigned" },
    { accessorKey: "plannedEnd", header: "Target finish", size: 140, cell: ({ row }) => row.original.plannedEnd || "Not scheduled" },
    { id: "next", header: "Next action", size: 200, accessorFn: work => byId.get(work.id)?.next ?? "Review item", cell: ({ row, getValue }) => <span data-grid-interactive><Button size="compact" variant="secondary" onPress={() => open(row.original)}>{canAct ? String(getValue()) : "View item"}<ArrowRight size={14} aria-hidden="true" /></Button></span> },
    { id: "supply", header: "Supply", size: 160, accessorFn: work => work.supplyMethod ? supplyLabels[work.supplyMethod] : "Not classified" },
    { id:"actions",header:"Actions",size:110,meta:{renderCell:work=><span data-grid-interactive><IconMenuButton ariaLabel={`Actions for ${work.title}`} items={[
      {id:'plan',label:'Supply & site plan'},
      {id:'steps',label:'Tasks & assignment'},
      {id:'materials',label:'Materials & procurement'},
      {id:'checks',label:'Readiness checks'},
      ...(work.workLocation==='factory'||state.data.tasks.some(task=>task.packageId===work.id&&task.location==='factory')?[{id:'factory',label:'Factory work'}]:[]),
      ...(work.siteWork&&work.siteWork!=='none'||state.data.tasks.some(task=>task.packageId===work.id&&task.location==='site')?[{id:'site',label:'Site work & progress'}]:[]),
      {id:'quality',label:'Quality & rework'},
      {id:'complete',label:'Handover & acceptance'},
    ]} onAction={key=>onOpen(work,String(key))}/></span>}},
    { id: "siteWork", header: "Site work", size: 150, accessorFn: work => work.siteWork ? siteLabels[work.siteWork] : "Not classified" },
    { id: "tasks", header: "Tasks complete", size: 140, accessorFn: work => { const current = byId.get(work.id); return current ? `${current.completedTasks} / ${current.totalTasks}` : "Not available"; } },
    { id: "blocker", header: "Blocker", size: 260, accessorFn: work => byId.get(work.id)?.blocked || "—" },
  ];
  return <div className={s.items}>
    {!!attention.length && <div className={s.attention} aria-label="Needs attention">{attention.slice(0, 3).map(action => <Link key={action.id} href={projectActionRoute(state.id, action)} data-priority={action.priority}><span className={s.attentionChip}>{action.priority === 'critical' ? 'Urgent' : action.priority === 'high' ? 'Needs attention' : 'To do'}</span><div className={s.attentionCopy}><strong>{action.title}</strong><small>{action.detail}</small></div><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>}
    <DataGrid gridLines appearance="flush" keepEmptyTable compactToolbar selectable={false} rowNumbers={false}
      ariaLabel="Project items" columns={columns} data={rows} getRowId={work => work.id} onRowAction={open}
      initialColumnVisibility={{ supply: false, siteWork: false, tasks: false, blocker: false }}
      savedViews={[{ id: "all", label: "All items" }, { id: "attention", label: "Needs attention" }, { id: "accepted", label: "Accepted" }]}
      selectedView={view} onViewChange={setView} searchLabel="Search items" searchValue={query} onSearchChange={setQuery}
      pageSize={50} exportFileName="project-items.csv"
      emptyContent={<div className={s.tableEmpty}><EmptyState title={items.length ? "No matching items" : "No approved items yet"} description={items.length ? "Choose another view or clear your filters." : "Release the approved BOQ to add project items."} /></div>}
      emptyTitle={items.length ? "No matching items" : "No approved items yet"}
      emptyDescription={items.length ? "Choose another view or clear your filters." : "Release the approved BOQ to add project items."}
    />
  </div>;
}
