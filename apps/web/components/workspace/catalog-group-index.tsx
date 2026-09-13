"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, List, IndianRupee, FolderOpen } from "lucide-react";
import { Button, Checkbox, DataGrid, SearchInput, type DataGridColumn } from "@/design-system";
import { catalogStructure, type CatalogRecord } from "@/lib/workspace/catalog";
import { catalogGroups, isMasterRecord, recordGroupId } from "@/lib/workspace/catalog-navigation";
import { CatalogIcon } from "./catalog-icons";
import tableStyles from "../crm/leads-page.module.css";
import styles from "./catalog-settings-page.module.css";

export function CatalogGroupIndex({items, catalogId, canManage=false, busy=false, onOpen, onEdit, onReorder}: {
  items: CatalogRecord[]; catalogId?: string; canManage?: boolean; busy?: boolean;
  onOpen: (record: CatalogRecord | string) => void;
  onEdit: (record: CatalogRecord) => void;
  onReorder?: (record: CatalogRecord, direction: number) => void;
}) {
  const [search,setSearch]=useState(""); const [archived,setArchived]=useState(false);
  const records=items.filter(r=>isMasterRecord(r) && !r.archived && (!catalogId || r.catalogId===catalogId));
  const groups=catalogGroups(items.filter(r=>r.catalogId===catalogId));
  const containers= catalogId
    ? (archived ? items.filter(r=>r.catalogId===catalogId && r.kind==="record_group" && r.archived) : groups)
    : items.filter(r=>r.kind==="catalog_group" && r.archived===archived).sort((a,b)=>a.name.localeCompare(b.name));
  const visible=containers.filter(r=>`${r.name} ${r.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const members=(r:CatalogRecord)=>records.filter(x=>catalogId ? recordGroupId(x)===r.id : x.catalogId===r.id);
  const open=(r:CatalogRecord)=>r.archived?onEdit(r):onOpen(r);
  const label=catalogId ? "Groups" : "Catalogs";
  const columns:DataGridColumn<CatalogRecord>[]=[
    {accessorKey:"name",header:catalogId?"Group name":"Catalog name",size:260,cell:({row})=><button className={tableStyles.tableLead} aria-label={row.original.name} onClick={()=>open(row.original)}><CatalogIcon record={row.original}/><span><strong>{row.original.name}</strong><small>{row.original.description || (row.original.archived?"Archived":"—")}</small></span></button>},
    ...(catalogId ? [{id:"contains",header:"Contains",size:380,accessorFn:(r:CatalogRecord)=>Array.from(new Set(members(r).map(x=>catalogStructure[x.kind].label))).join(", "),cell:({row:{original:r}})=>{const types=Array.from(new Set(members(r).map(x=>x.kind))).sort((a,b)=>Number(b===r.configuration?.defaultKind)-Number(a===r.configuration?.defaultKind));return <div className={styles.typeChips}>{types.slice(0,3).map(kind=><span key={kind}><CatalogIcon kind={kind}/>{catalogStructure[kind].label}</span>)}{types.length>3&&<span title={types.slice(3).map(kind=>catalogStructure[kind].label).join(", ")}>+{types.length-3}</span>}{!types.length&&<span>Add your first record</span>}</div>;}} satisfies DataGridColumn<CatalogRecord>] : [{id:"groups",header:"Groups",size:90,accessorFn:(r:CatalogRecord)=>items.filter(g=>g.catalogId===r.id&&g.kind==="record_group"&&!g.archived).length}]),
    {id:"records",header:"Records",size:90,accessorFn:r=>members(r).length},
    {accessorKey:"updatedAt",header:"Updated",size:130,cell:({row})=>row.original.updatedAt?new Date(row.original.updatedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}):"—"},
    {id:"actions",header:"",size:110,enableSorting:false,cell:({row:{original:r}})=><div className={styles.rowActions} data-grid-interactive>
      {canManage&&catalogId&&!archived&&onReorder&&<>
        <Button size="compact" variant="quiet" aria-label={`Move ${r.name} up`} isDisabled={busy||groups[0]?.id===r.id} onPress={()=>onReorder(r,-1)}><ArrowUp size={13}/></Button>
        <Button size="compact" variant="quiet" aria-label={`Move ${r.name} down`} isDisabled={busy||groups.at(-1)?.id===r.id} onPress={()=>onReorder(r,1)}><ArrowDown size={13}/></Button>
      </>}
      <Button size="compact" variant="quiet" aria-label={`Details for ${r.name}`} onPress={()=>onEdit(r)}><MoreHorizontal size={16}/></Button>
    </div>},
  ];
  return <section className={styles.body} aria-label={`${label} list`}>
    <div className={tableStyles.boardToolbar}>
      <div className={tableStyles.listHeading}><h2>{label}</h2><span>{containers.length}</span></div>
      <div className={tableStyles.listControls}><Checkbox isSelected={archived} onChange={setArchived}>Archived</Checkbox><SearchInput label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={setSearch}/></div>
    </div>
    <p className={styles.flowHint}>{catalogId?"These groups are editable. Open a row to view records, or add a group with any name.":"Create a named catalog, organise it into your own groups, then add rooms, items, materials and more."}</p>
    {catalogId&&!archived&&<div className={styles.groupShortcuts}>
      <button onClick={()=>onOpen("all")}><List size={14}/>All records <span>{records.length}</span></button>
      <button onClick={()=>onOpen("prices")}><IndianRupee size={14}/>Prices <span>{records.filter(r=>r.kind==="rate_card").length}</span></button>
      {records.some(r=>!recordGroupId(r))&&<button onClick={()=>onOpen("ungrouped")}><FolderOpen size={14}/>Ungrouped <span>{records.filter(r=>!recordGroupId(r)).length}</span></button>}
    </div>}
    <div className={tableStyles.tableRegion}>
      <DataGrid appearance="flush" ariaLabel={label} columns={columns} data={visible} getRowId={r=>r.id} onRowAction={open} selectable={false} showToolbar={false} pageSize={25} emptyTitle={search?"No matches":`No ${archived?"archived ":""}${label.toLowerCase()} yet`} emptyDescription={catalogId?"Add a group with any name, or open All records to organise existing data.":"Create a catalog with any name. Start blank or with the starter library."}/>
    </div>
  </section>;
}
