"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { Button, DataGrid, SelectField, ControlledModalDialog, type DataGridColumn } from "@/design-system";
import type { ProjectData, ProjectState, ProjectWorkPackage } from "@/lib/projects/execution";
import { label } from "@/lib/projects/execution";
import { money } from "@/lib/commercial/client";
import { quotationDimensionsText } from "@/lib/commercial/presentation";
import styles from "./project-boq.module.css";
import workspaceStyles from "../workspace/workspace.module.css";

type ScopeLine = NonNullable<ProjectData["scope"]>["lines"][number];

export function ProjectBoq({ state, onEditWork }: { state: ProjectState; onEditWork: (work: ProjectWorkPackage) => void }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("scopeTab");
  const tab = requestedTab === "designs" ? "designs" : "boq";
  const [selected, setSelected] = useState<ScopeLine | null>(null);
  const [area, setArea] = useState("");
  const [item, setItem] = useState("");
  const [query, setQuery] = useState("");
  const scope = state.data.scope;
  const root = `/workspace/projects/${state.id}`;
  const quoteHref = `/workspace/pre-projects/cases/${state.caseId}/quotations${scope ? `?quote=${encodeURIComponent(scope.quoteId)}` : ""}`;
  const variations = state.data.variations ?? [];
  const deducted = new Set(variations.filter(v => v.direction === "deduction").flatMap(v => v.lines).map(line => line.deductsLineId).filter(Boolean));
  const rows = [...(scope?.lines ?? []), ...variations.filter(v => v.direction !== "deduction").flatMap(v => v.lines)].filter(line => !deducted.has(line.id));
  const designs = (state.data.documents ?? []).filter(doc => doc.status === "approved" && ["drawing", "specification"].includes(doc.kind));
  const packages = (state.data.workPackages ?? []).filter(work => work.status !== "cancelled");
  const areas = Array.from(new Set([...rows.map(line => line.room || "Unassigned"), ...packages.map(work => work.area || "Unassigned")])).sort();
  const items = Array.from(new Set(rows.map(line=>line.title))).sort((a,b)=>a.localeCompare(b));
  const matches = (values: unknown[]) => values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const visibleRows = rows.filter(line => (!item || line.title===item) && (!area || (line.room || "Unassigned") === area) && matches([line.title, line.room, line.material, line.specification]));
  const visibleDesigns = designs.filter(doc => ((!area && !item) || rows.some(line => (!area || (line.room || "Unassigned") === area) && (!item || line.title===item) && doc.scopeLineIds?.includes(line.id))) && matches([doc.title, doc.kind, doc.revision]));
  const filtered = Boolean(area || item || query.trim());
  const columns: DataGridColumn<ScopeLine>[] = [
    { id:"execution", header:"Work", size:140, cell:({row}) => { const linked=packages.find(work=>work.scopeLineIds.includes(row.original.id)); return linked&&state.canManage?<span data-grid-interactive><Button size="compact" onPress={()=>onEditWork(linked)}>{linked.status==='planning'?'Plan item':'Open work'}</Button></span>:<Button size="compact" variant="quiet" onPress={()=>setSelected(row.original)}>View item</Button>; } },
    { accessorKey:"room", header:"Room / area", size:160 },
    { accessorKey:"title", header:"Item", size:260, meta:{primary:true} },
    { accessorKey:"material", header:"Material / specification", size:280, cell:({row}) => <span className={styles.wrap}>{row.original.material || row.original.specification || "Not specified"}</span> },
    ...(rows.some(line=>Boolean(quotationDimensionsText(line.dimensions)))?[{ id:"dimensions", header:"Quoted dimensions", size:180, accessorFn:(line:ScopeLine) => quotationDimensionsText(line.dimensions) || "—" }]:[]),
    { accessorKey:"quantity", header:"Qty", size:80, meta:{align:"end"} },
    { accessorKey:"unit", header:"Unit", size:80 },
    { accessorKey:"rate", header:"Rate", size:120, meta:{align:"end"}, cell:({row}) => Number.isFinite(row.original.rate) ? money(row.original.rate!,scope?.currency ?? "") : "—" },
    { accessorKey:"lineTotal", header:"Amount", size:140, meta:{align:"end"}, cell:({row}) => Number.isFinite(row.original.lineTotal) ? money(row.original.lineTotal!,scope?.currency ?? "") : "—" },
  ];
  return <section className={`${styles.scope} ${workspaceStyles.recordTablePanel}`} aria-label="Scope and design">
    <div className={styles.topline}>
      <div className={styles.filters}>
        <label className={styles.search}><Search size={14} aria-hidden="true"/><input aria-label="Search scope and design" placeholder={tab === "designs" ? "Search designs…" : "Search items…"} value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <div className={styles.areaFilter}><SelectField label={null} aria-label="Filter by room or area" items={[{id:"all-areas",label:"All rooms / areas"},...areas.map(value=>({id:value,label:value}))]} selectedKey={area || "all-areas"} onSelectionChange={key=>setArea(key === "all-areas" ? "" : String(key ?? ""))}/></div>
        <div className={styles.areaFilter}><SelectField label={null} aria-label="Filter by item" items={[{id:"all-items",label:"All items"},...items.map(value=>({id:`item:${value}`,label:value}))]} selectedKey={item ? `item:${item}` : "all-items"} onSelectionChange={key=>setItem(key && String(key).startsWith("item:") ? String(key).slice(5) : "")}/></div>
        {filtered && <Button size="compact" variant="quiet" onPress={()=>{setArea("");setItem("");setQuery("");}}>Clear</Button>}
      </div>
      {tab === "boq" ? <Link className={styles.source} href={quoteHref}>Source quotation <ArrowUpRight size={14} aria-hidden="true" /></Link> : tab === "designs" ? <Link className={styles.source} href={`/workspace/pre-projects/cases/${state.caseId}/designs`}>Design folders <ArrowUpRight size={14} aria-hidden="true" /></Link> : <Link className={styles.source} href={`${root}/material-planning`}>Material requirements <ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div>
    {tab === "boq" && <><DataGrid gridLines appearance="flush" showToolbar={false} showFooter={rows.length > 50} pageSize={50} ariaLabel="Project BOQ" columns={columns} data={visibleRows} getRowId={line=>line.id} onRowAction={setSelected} selectable={false} rowNumbers={false} searchLabel="Search BOQ" exportFileName="project-boq.csv" emptyTitle={filtered ? "No matching items" : "No released BOQ yet"} emptyDescription={filtered ? "Change the search, room / area or item filter." : "Accepted quotation items appear after commercial release. Review the source quotation to continue."} /><div className={styles.summary}><span>{visibleRows.length} of {rows.length} items · {new Set(rows.map(line=>line.room).filter(Boolean)).size} areas</span>{scope && <span>Original contract value <strong>{money(scope.value,scope.currency)}</strong></span>}</div></>}
    {tab === "designs" && <DataGrid gridLines appearance="flush" showToolbar={false} showFooter={designs.length > 50} pageSize={50} ariaLabel="Approved project designs" data={visibleDesigns} columns={[
      {accessorKey:"title",header:"Design / drawing",size:280}, {accessorKey:"kind",header:"Type",size:140,cell:({row})=>label(row.original.kind)}, {accessorKey:"revision",header:"Revision",size:100},
      {id:"items",header:"Linked items",size:260,accessorFn:doc=>rows.filter(line=>doc.scopeLineIds?.includes(line.id)).map(line=>line.title).join(", ") || "No item linked"},
      {id:"open",header:"",size:130,cell:({row})=><Link className={styles.source} href={`${root}/documents?record=${encodeURIComponent(row.original.id)}`}>View design <ArrowUpRight size={14}/></Link>}
    ]} getRowId={doc=>doc.id} selectable={false} rowNumbers={false} emptyTitle={filtered ? "No matching designs" : "No approved designs"} emptyDescription="Approve the relevant drawing or specification before releasing work." toolbarActions={<Link className={styles.source} href={`/workspace/pre-projects/cases/${state.caseId}/designs`}>Design folders <ArrowUpRight size={14}/></Link>} />}
    <ControlledModalDialog isOpen={Boolean(selected)} onOpenChange={open=>{if(!open)setSelected(null);}} title={selected?.title ?? "BOQ item"} size="lg">
      {selected && <div className={styles.details}><dl><dt>Room / area</dt><dd>{selected.room || "Unassigned"}</dd><dt>Quantity</dt><dd>{selected.quantity} {selected.unit}</dd><dt>Quoted dimensions</dt><dd>{quotationDimensionsText(selected.dimensions) || "Not specified"}</dd><dt>Material</dt><dd>{selected.material || "Not specified"}</dd><dt>Specification</dt><dd>{selected.specification || "Not specified"}</dd></dl>
      <h3>Procurement</h3><Link href={`${root}/material-planning?scope=${encodeURIComponent(selected.id)}`}>Requirements & stock · {(state.data.materials??[]).filter(m=>m.scopeLineId===selected.id).length} requirements ↗</Link>
      <h3>Approved designs</h3>{designs.filter(doc=>doc.scopeLineIds?.includes(selected.id)).length ? designs.filter(doc=>doc.scopeLineIds?.includes(selected.id)).map(doc=><Link key={doc.id} href={`${root}/documents?record=${encodeURIComponent(doc.id)}`}>{doc.title} · {doc.revision}</Link>) : <p>No approved design linked to this item.</p>}
      <h3>Linked work</h3>{packages.filter(work=>work.scopeLineIds.includes(selected.id)).map(work=><div className={styles.linkedWork} key={work.id}><span>{work.title} · {label(work.status)}</span>{state.canManage && <Button size="compact" onPress={()=>{setSelected(null);onEditWork(work);}}>{work.status==='planning'?'Plan item':'Open work'}</Button>}</div>)}{!packages.some(work=>work.scopeLineIds.includes(selected.id)) && <p>No work package linked yet.</p>}
      <Link className={styles.source} href={quoteHref}>View original quotation <ArrowUpRight size={14}/></Link></div>}
    </ControlledModalDialog>
  </section>;
}
