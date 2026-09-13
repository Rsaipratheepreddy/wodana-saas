"use client";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, ComboboxField, SearchInput, useDesignSystem, type SelectItem } from "@/design-system";
import styles from "./catalog-settings-page.module.css";

export function CatalogRecordPicker({label,items,selectedKey,onChange,isDisabled=false,isRequired=false}:{label:string;items:SelectItem[];selectedKey:string|null;onChange:(id:string)=>void;isDisabled?:boolean;isRequired?:boolean}) {
  const [search,setSearch]=useState("");
  const selected=items.find(r=>r.id===selectedKey);
  const options=items.filter(r=>r.id===selectedKey||!search||search===selected?.label||r.label.toLowerCase().includes(search.toLowerCase()));
  const visible=options.slice(0,100);if(selected&&!visible.some(r=>r.id===selected.id))visible.unshift(selected);
  return <div className={styles.recordPicker}><ComboboxField label={label} isRequired={isRequired} isDisabled={isDisabled} selectedKey={selectedKey} onSelectionChange={key=>{if(key!==null)onChange(String(key));}} onInputChange={setSearch} items={visible} placeholder={`Search ${label.toLowerCase()}…`}/>{options.length>100&&search&&search!==selected?.label&&<small className={styles.muted}>Search to narrow down {options.length} records.</small>}{selectedKey&&!isRequired&&<Button variant="quiet" size="compact" aria-label={`Clear ${label}`} isDisabled={isDisabled} onPress={()=>{setSearch("");onChange("");}}>Clear</Button>}</div>;
}
export function CatalogMultiplePicker({label,items,selected,onChange,disabled=false}:{label:string;items:SelectItem[];selected:string[];onChange:(ids:string[])=>void;disabled?:boolean}) {
  const [search,setSearch]=useState("");
  const [open,setOpen]=useState(false);
  const {portalContainer}=useDesignSystem();
  const visible=items.filter(r=>r.label.toLowerCase().includes(search.toLowerCase()));
  return <div className={styles.multiPicker}><span>{label}{selected.length?` · ${selected.length} selected`:""}</span>
    <DialogTrigger isOpen={open} onOpenChange={setOpen}><Button isDisabled={disabled} aria-label={`Choose ${label}`}><span className={styles.pickerSelection}>{selected.length?items.filter(r=>selected.includes(r.id)).map(r=>r.label).join(", "):"Select records…"}</span><ChevronDown size={14}/></Button><Popover UNSTABLE_portalContainer={portalContainer??undefined} className={`wd-popover ${styles.multiPopover}`} placement="bottom start"><Dialog aria-label={label}>
    <SearchInput label={`Search ${label.toLowerCase()}`} placeholder="Search records…" value={search} onChange={setSearch} isDisabled={disabled}/>
    <div className={styles.pickerChoices}>{visible.slice(0,100).map(r=><Checkbox key={r.id} isDisabled={disabled} isSelected={selected.includes(r.id)} onChange={checked=>onChange(checked?[...selected,r.id]:selected.filter(id=>id!==r.id))}>{r.label}</Checkbox>)}</div>
    {!visible.length&&<small className={styles.muted}>No matching records in this catalog.</small>}
    {visible.length>100&&<small className={styles.muted}>Search to narrow down {visible.length} records.</small>}
    <Button size="compact" onPress={()=>setOpen(false)}>Done</Button></Dialog></Popover></DialogTrigger>
  </div>;
}
