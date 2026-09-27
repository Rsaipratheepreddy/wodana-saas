"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {Archive, ArrowUpRight, FileText, History, Plus, RotateCcw} from 'lucide-react';
import {Badge, Button, Callout, ConfirmationDialog, DataGrid, InspectorSheet, formatDate, useDesignSystem, type DataGridColumn} from '@/design-system';
import {useT} from '@/lib/i18n/i18n-provider';
import {translateKnown} from '@/lib/i18n/keys';
import type {QuotationTemplate, QuoteLine} from '@/lib/commercial/types';
import type {WorkspaceConfigurationRevision} from '@/lib/workspace/company-profile';
import {money} from '@/lib/commercial/client';
import styles from '../workspace/catalog-hierarchy.module.css';
import theme from '../crm/crm-workspace-colors.module.css';

export function QuotationTemplatesPage({workspaceId,items,error}:{workspaceId:string;items:QuotationTemplate[];error?:string}) {
  const t=useT();
  const {locale,timeZone}=useDesignSystem();
  const router=useRouter();
  const [selected,setSelected]=useState<QuotationTemplate|null>(null);
  const [historyTemplate,setHistoryTemplate]=useState<QuotationTemplate|null>(null);
  const [revisions,setRevisions]=useState<WorkspaceConfigurationRevision[]>([]);
  const [actionError,setActionError]=useState('');
  const [busy,setBusy]=useState(false);
  const [archiveTarget,setArchiveTarget]=useState<QuotationTemplate|null>(null);
  const [rollbackTarget,setRollbackTarget]=useState<WorkspaceConfigurationRevision|null>(null);
  const columns:DataGridColumn<QuotationTemplate>[]=[
    {id:'name',header:t('Template'),size:300,accessorKey:'name',meta:{headerIcon:<FileText size={14}/>},cell:({row:{original:r}})=><span>{r.name}</span>},
    {id:'rooms',header:t('Rooms'),size:270,accessorFn:r=>[...new Set(r.content.lines.map(l=>l.room))].join(', ')},
    {id:'items',header:t('Items'),size:95,accessorFn:r=>r.content.lines.length},
    {id:'currency',header:t('Currency'),size:105,accessorFn:r=>r.content.currency},
    {id:'updated',header:t('Updated'),size:150,accessorFn:r=>formatDate(r.updatedAt,{locale,timeZone},{day:'numeric',month:'short',year:'numeric'})},
  ];
  const lineColumns:DataGridColumn<QuoteLine>[]=[{accessorKey:'title',header:t('Item'),size:240},{accessorKey:'room',header:t('Room'),size:160},{accessorKey:'quantity',header:t('Quantity'),size:100},{accessorKey:'unit',header:t('Unit'),size:100},{id:'rate',header:t('Rate'),size:140,accessorFn:r=>selected?money(r.rate,selected.content.currency,locale):String(r.rate)}];
  const responseMessage=async(response:Response,fallback:string)=>{const payload=await response.json().catch(()=>null) as {message?:string}|null;return payload?.message??fallback;};
  const openHistory=async(template:QuotationTemplate)=>{setSelected(null);setHistoryTemplate(template);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${template.id}/history?workspaceId=${encodeURIComponent(workspaceId)}`);if(!response.ok)throw new Error(await responseMessage(response,t('Template history could not be loaded.')));setRevisions(await response.json() as WorkspaceConfigurationRevision[]);}catch(failure){setRevisions([]);setActionError(failure instanceof Error?failure.message:t('Template history could not be loaded.'));}};
  const archiveTemplate=async()=>{if(!archiveTarget||busy)return;setBusy(true);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${archiveTarget.id}/archive?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:archiveTarget.version})});if(!response.ok)throw new Error(await responseMessage(response,t('Template could not be archived.')));setArchiveTarget(null);setSelected(null);router.refresh();}catch(failure){setActionError(failure instanceof Error?failure.message:t('Template could not be archived.'));setArchiveTarget(null);}finally{setBusy(false);}};
  const rollback=async()=>{if(!historyTemplate||!rollbackTarget||busy)return;setBusy(true);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${historyTemplate.id}/rollback?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:historyTemplate.version,revisionId:rollbackTarget.id})});if(!response.ok)throw new Error(await responseMessage(response,t('Template could not be restored.')));setRollbackTarget(null);setHistoryTemplate(null);router.refresh();}catch(failure){setActionError(failure instanceof Error?failure.message:t('Template could not be restored.'));setRollbackTarget(null);}finally{setBusy(false);}};
  return <section className={`${styles.page} ${theme.theme}`} aria-label={t("Quotation Templates workspace")}>
    <header className={styles.header}><h1>{t("Quotation Templates")}</h1><Link className={styles.link} href="/workspace/pre-projects?section=quotations"><Plus size={15}/>{t("Create from a quotation")}<ArrowUpRight size={13}/></Link></header>
    <p className={styles.context}>{t("Save a quotation as a template to reuse its rooms, items, materials, rates and terms.")}</p>
    {error?<Callout tone="danger" title={t("Templates could not be loaded")} actions={<Button onPress={()=>router.refresh()}>{t("Try again")}</Button>}>{translateKnown(t,error)}</Callout>:<DataGrid ariaLabel={t("Quotation Templates")} columns={columns} data={items} getRowId={r=>r.id} searchLabel={t("Search quotation templates")} onRowAction={r=>setSelected(r)} emptyTitle={t("No quotation templates yet")} emptyDescription={t("Open a quotation and choose Convert to template to save it for reuse.")} exportFileName="quotation-templates.csv"/>}
    <InspectorSheet isOpen={Boolean(selected)} onOpenChange={open=>{if(!open)setSelected(null)}} size="lg" title={selected?.name || t('Quotation template')} footer={selected?<div className={styles.actions}><Button variant="quiet" onPress={()=>void openHistory(selected)}><History size={14}/>{t("History")}</Button><Button variant="quiet" onPress={()=>setArchiveTarget(selected)}><Archive size={14}/>{t("Archive")}</Button></div>:undefined}>
      {selected&&<><p className={styles.context}>{t("Rates are saved in {currency}. Review and apply this template from a draft quotation’s Templates tab.",{currency:selected.content.currency})}</p><DataGrid ariaLabel={t("Template items")} columns={lineColumns} data={selected.content.lines} getRowId={r=>r.id} selectable={false} pageSize={20}/><dl className={styles.summary}><div><dt>{t("Inclusions")}</dt><dd>{selected.content.inclusions||'—'}</dd></div><div><dt>{t("Exclusions")}</dt><dd>{selected.content.exclusions||'—'}</dd></div><div><dt>{t("Terms")}</dt><dd>{selected.content.terms||'—'}</dd></div><div><dt>{t("Payment schedule")}</dt><dd>{selected.content.paymentTerms.map(term=>`${term.title} (${term.percent}%)`).join(', ')||'—'}</dd></div></dl><Link className={styles.link} href="/workspace/pre-projects?section=quotations">{t("Open quotations")}<ArrowUpRight size={13}/></Link></>}
    </InspectorSheet>
    <InspectorSheet isOpen={Boolean(historyTemplate)} onOpenChange={open=>{if(!open&&!busy)setHistoryTemplate(null)}} size="sm" title={historyTemplate?t("{name} history",{name:historyTemplate.name}):t('Template history')} description={t("Every save is retained. Restoring creates a new revision and never deletes later history.")}>
      {actionError?<Callout tone="danger" title={t("Template history unavailable")}>{translateKnown(t,actionError)}</Callout>:null}
      {!actionError&&!revisions.length?<p className={styles.context}>{t("No saved changes yet.")}</p>:null}
      {revisions.length?<ol className={styles.historyList}>{revisions.map((revision,index)=><li key={revision.id}><div><strong>{t("Revision {number}",{number:revision.revisionNumber})}</strong>{index===0?<Badge tone="neutral">{t("Current")}</Badge>:null}</div><small>{t(revision.changes.length===1?"{date} · {count} changed field":"{date} · {count} changed fields",{date:formatDate(revision.createdAt,{locale,timeZone},{dateStyle:'medium',timeStyle:'short'}),count:revision.changes.length})}</small>{index?<Button isDisabled={busy} onPress={()=>setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw size={14}/>{t("Restore")}</Button>:null}</li>)}</ol>:null}
    </InspectorSheet>
    <ConfirmationDialog isOpen={Boolean(archiveTarget)} onOpenChange={open=>{if(!open&&!busy)setArchiveTarget(null)}} title={t("Archive this template?")} body={t("It will stop appearing in quotation creation. Existing quotations and revision history stay unchanged.")} confirmLabel={t(busy?'Archiving…':'Archive template')} onConfirm={()=>void archiveTemplate()}/>
    <ConfirmationDialog isOpen={Boolean(rollbackTarget)} onOpenChange={open=>{if(!open&&!busy)setRollbackTarget(null)}} title={t("Restore this template revision?")} body={t("The selected rooms, items, rates and terms will become the current template. The current version stays in history.")} confirmLabel={t(busy?'Restoring…':'Restore revision')} onConfirm={()=>void rollback()}/>
  </section>;
}
