"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from 'react';
import { ArrowRight, Plus, Search } from 'lucide-react';
import type { CommercialCatalogChoice } from './catalog-picker';
import { useCatalogOptions } from './catalog-options-cache';
import s from './quotation-workbench.module.css';
export function QuotationRoomPicker({workspaceId,caseId,catalogId,onChoose,onCustom}:{workspaceId:string;caseId:string;catalogId?:string;onChoose:(room:CommercialCatalogChoice)=>void;onCustom:(name:string)=>void}) {
  const t = useT();
  const [search,setSearch]=useState('');
  const {items,loading,error,refresh}=useCatalogOptions(workspaceId,caseId,'room',search,undefined,catalogId);
  return <div className={s.roomPicker}><label className={s.compactSearch}><Search size={15}/><input autoFocus type="search" aria-label={t("Search rooms")} placeholder={t("Search rooms…")} value={search} maxLength={120} onChange={e=>setSearch(e.target.value)}/></label>{loading&&<p className={s.hint} role="status">{t("Loading rooms…")}</p>}{error&&<p className={s.error} role="alert">{error} <button className={s.textButton} onClick={refresh}>{t("Retry")}</button></p>}<div className={s.roomChoices}>{items.map(room=><button key={room.id} onClick={()=>onChoose(room)}><span>{room.name}</span><ArrowRight size={15}/></button>)}</div><button className={s.textButton} onClick={()=>onCustom(search.trim()||t('New room'))}><Plus size={14}/>{search.trim()?t('Create “{name}”',{name:search.trim()}):t('Custom room')}</button></div>;
}
