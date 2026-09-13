"use client";
import { Plus, Pencil } from "lucide-react";
import { CatalogIcon } from "./catalog-icons";
import { unitMeaning } from "@/lib/workspace/catalog-units";
import { Checkbox, DataGrid, type DataGridColumn } from "@/design-system";
import { catalogStructure, type CatalogKind, type CatalogRecord } from "@/lib/workspace/catalog";
import { importedPrices, priceableKinds, priceLabel, recordPrices } from "@/lib/workspace/catalog-prices";
import tableStyles from "../crm/leads-page.module.css";
import styles from "./catalog-settings-page.module.css";

export function CatalogRecordTable({kind,rows,items,canManage,selectedIds,onSelectionChange,onOpen,onPrice}:{kind:CatalogKind|"all";rows:CatalogRecord[];items:CatalogRecord[];canManage:boolean;selectedIds:string[];onSelectionChange:(ids:string[])=>void;onOpen:(r:CatalogRecord)=>void;onPrice:(r:CatalogRecord)=>void}) {
  const byId=new Map(items.map(r=>[r.id,r]));
  const linked=(r:CatalogRecord,relation:string)=>r.links.filter(l=>l.relation===relation).map(l=>byId.get(l.targetId)?.name).filter(Boolean).join(", ");
  const tableKind=kind==="all"&&rows.length&&new Set(rows.map(r=>r.kind)).size===1?rows[0].kind:kind;
  const definition=tableKind==="all"?null:catalogStructure[tableKind];
  const preferred:Partial<Record<CatalogKind,string[]>>={work:["unit","material","finish","execution"],material:["unit","brand","finish"],site_process:["unit","execution","resource"],factory_process:["unit","execution","resource"],rate_card:["unit","material"]};
  const mixedRelations=rows.some(r=>r.kind==="material")?["unit","brand","finish"]:rows.some(r=>["factory_process","site_process"].includes(r.kind))?["unit","execution","resource"]:["unit","material","brand"];
  const relations=tableKind==="all"?mixedRelations.filter(relation=>rows.some(r=>catalogStructure[r.kind].links.some(l=>l.relation===relation))):(preferred[tableKind]??definition!.links.map(l=>l.relation).filter(l=>!["record_group","parent","category"].includes(l)).slice(0,4));
  const columns:DataGridColumn<CatalogRecord>[]=[
    ...(canManage?[{id:"__select",header:()=><Checkbox aria-label="Select visible records" isSelected={rows.length>0&&rows.every(r=>selectedIds.includes(r.id))} isIndeterminate={rows.some(r=>selectedIds.includes(r.id))&&!rows.every(r=>selectedIds.includes(r.id))} onChange={checked=>onSelectionChange(checked?rows.map(r=>r.id):[])}/>,cell:({row:{original:r}})=><Checkbox aria-label={`Select ${r.name}`} isSelected={selectedIds.includes(r.id)} onChange={checked=>onSelectionChange(checked?[...selectedIds,r.id]:selectedIds.filter(id=>id!==r.id))}/>,size:40,enableSorting:false} satisfies DataGridColumn<CatalogRecord>]:[]),
    {accessorKey:"name",header:"Name",size:280,cell:({row:{original:r}})=><button className={tableStyles.tableLead} aria-label={`Open ${r.name}`} onClick={()=>onOpen(r)}><CatalogIcon record={r}/><span><strong>{r.name}</strong><small title={r.description}>{r.description||r.code}</small></span></button>},
    ...(kind==="all"?[{id:"kind",header:"Type",accessorFn:(r:CatalogRecord)=>catalogStructure[r.kind].label,size:150,cell:({row:{original:r}})=><span className={styles.typeBadge}>{catalogStructure[r.kind].label}</span>} satisfies DataGridColumn<CatalogRecord>]:[]),
    ...relations.map(relation=>({id:relation,header:relation==="unit"?"Unit":relation==="execution"?"Execution":catalogStructure[relation as CatalogKind]?.label??relation,size:160,accessorFn:(r:CatalogRecord)=>linked(r,relation)||"—"})),
    ...(tableKind==="unit"?[{id:"conversion",header:"Measurement & conversion",size:290,accessorFn:(r:CatalogRecord)=>unitMeaning(r)}]:[]),
    ...(tableKind!=="rate_card"&&definition?definition.fields.slice(0,2).map(f=>({id:f.key,header:f.label,size:160,accessorFn:(r:CatalogRecord)=>String(r.configuration?.[f.key]??"—").replaceAll("_"," ")})):[]),
    ...(tableKind==="rate_card"||rows.some(r=>priceableKinds.includes(r.kind))||tableKind!=="all"&&priceableKinds.includes(tableKind)?[{id:"price",header:"Price / unit",size:190,accessorFn:(r:CatalogRecord)=>recordPrices(r,items).map(p=>priceLabel(p,items)).join(", "),cell:({row:{original:r}})=>{
      if(!priceableKinds.includes(r.kind)&&r.kind!=="rate_card")return <span className={styles.muted}>—</span>;
      const prices=recordPrices(r,items),imported=importedPrices(r);
      return <button className={styles.priceButton} title={imported.length&&!prices.length?'Imported amounts need review of unit, tax, inclusions and effective date.':undefined} onClick={()=>onPrice(r)}>{prices.length||imported.length?<Pencil size={12} aria-hidden="true"/>:<Plus size={12} aria-hidden="true"/>}{prices.length===1?priceLabel(prices[0],items):prices.length?`${prices.length} prices`:imported.length?`${imported[0].formatted}${imported.length>1?` +${imported.length-1}`:''} · Imported`:canManage?"Add price":"Price not set"}</button>;
    }} satisfies DataGridColumn<CatalogRecord>]:[]),
  ];
  return <div className={`${tableStyles.tableRegion} ${styles.recordTable}`}><DataGrid appearance="flush" ariaLabel="Catalog records" columns={columns} data={rows} getRowId={r=>r.id} selectable={false} showToolbar={false} showFooter={false} manualPagination onRowAction={onOpen} emptyTitle="No records here yet" emptyDescription="Add a record, paste rows with Edit table, or choose another type."/></div>;
}
