"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {Archive, ArrowUpRight, FileText, History, Plus, RotateCcw} from 'lucide-react';
import {Badge, Button, Callout, ConfirmationDialog, DataGrid, InspectorSheet, type DataGridColumn} from '@/design-system';
import type {QuotationTemplate, QuoteLine} from '@/lib/commercial/types';
import type {WorkspaceConfigurationRevision} from '@/lib/workspace/company-profile';
import {money} from '@/lib/commercial/client';
import styles from '../workspace/catalog-hierarchy.module.css';
import theme from '../crm/crm-workspace-colors.module.css';

export function QuotationTemplatesPage({workspaceId,items,error}:{workspaceId:string;items:QuotationTemplate[];error?:string}) {
  const router=useRouter();
  const [selected,setSelected]=useState<QuotationTemplate|null>(null);
  const [historyTemplate,setHistoryTemplate]=useState<QuotationTemplate|null>(null);
  const [revisions,setRevisions]=useState<WorkspaceConfigurationRevision[]>([]);
  const [actionError,setActionError]=useState('');
  const [busy,setBusy]=useState(false);
  const [archiveTarget,setArchiveTarget]=useState<QuotationTemplate|null>(null);
  const [rollbackTarget,setRollbackTarget]=useState<WorkspaceConfigurationRevision|null>(null);
  const columns:DataGridColumn<QuotationTemplate>[]=[
    {id:'name',header:'Template',size:300,accessorKey:'name',meta:{headerIcon:<FileText size={14}/>},cell:({row:{original:r}})=><span>{r.name}</span>},
    {id:'rooms',header:'Rooms',size:270,accessorFn:r=>[...new Set(r.content.lines.map(l=>l.room))].join(', ')},
    {id:'items',header:'Items',size:95,accessorFn:r=>r.content.lines.length},
    {id:'currency',header:'Currency',size:105,accessorFn:r=>r.content.currency},
    {id:'updated',header:'Updated',size:150,accessorFn:r=>new Date(r.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})},
  ];
  const lineColumns:DataGridColumn<QuoteLine>[]=[{accessorKey:'title',header:'Item',size:240},{accessorKey:'room',header:'Room',size:160},{accessorKey:'quantity',header:'Quantity',size:100},{accessorKey:'unit',header:'Unit',size:100},{id:'rate',header:'Rate',size:140,accessorFn:r=>money(r.rate,selected?.content.currency)}];
  const responseMessage=async(response:Response,fallback:string)=>{const payload=await response.json().catch(()=>null) as {message?:string}|null;return payload?.message??fallback;};
  const openHistory=async(template:QuotationTemplate)=>{setSelected(null);setHistoryTemplate(template);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${template.id}/history?workspaceId=${encodeURIComponent(workspaceId)}`);if(!response.ok)throw new Error(await responseMessage(response,'Template history could not be loaded.'));setRevisions(await response.json() as WorkspaceConfigurationRevision[]);}catch(failure){setRevisions([]);setActionError(failure instanceof Error?failure.message:'Template history could not be loaded.');}};
  const archiveTemplate=async()=>{if(!archiveTarget||busy)return;setBusy(true);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${archiveTarget.id}/archive?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:archiveTarget.version})});if(!response.ok)throw new Error(await responseMessage(response,'Template could not be archived.'));setArchiveTarget(null);setSelected(null);router.refresh();}catch(failure){setActionError(failure instanceof Error?failure.message:'Template could not be archived.');setArchiveTarget(null);}finally{setBusy(false);}};
  const rollback=async()=>{if(!historyTemplate||!rollbackTarget||busy)return;setBusy(true);setActionError('');try{const response=await fetch(`/api/commercial/quotation-templates/${historyTemplate.id}/rollback?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:historyTemplate.version,revisionId:rollbackTarget.id})});if(!response.ok)throw new Error(await responseMessage(response,'Template could not be restored.'));setRollbackTarget(null);setHistoryTemplate(null);router.refresh();}catch(failure){setActionError(failure instanceof Error?failure.message:'Template could not be restored.');setRollbackTarget(null);}finally{setBusy(false);}};
  return <section className={`${styles.page} ${theme.theme}`} aria-label="Quotation Templates workspace">
    <header className={styles.header}><h1>Quotation Templates</h1><Link className={styles.link} href="/workspace/pre-projects?section=quotations"><Plus size={15}/>Create from a quotation<ArrowUpRight size={13}/></Link></header>
    <p className={styles.context}>Save a quotation as a template to reuse its rooms, items, materials, rates and terms.</p>
    {error?<Callout tone="danger" title="Templates could not be loaded" actions={<Button onPress={()=>router.refresh()}>Try again</Button>}>{error}</Callout>:<DataGrid ariaLabel="Quotation Templates" columns={columns} data={items} getRowId={r=>r.id} searchLabel="Search quotation templates" onRowAction={r=>setSelected(r)} emptyTitle="No quotation templates yet" emptyDescription="Open a quotation and choose Convert to template to save it for reuse." exportFileName="quotation-templates.csv"/>}
    <InspectorSheet isOpen={Boolean(selected)} onOpenChange={open=>{if(!open)setSelected(null)}} size="lg" title={selected?.name || 'Quotation template'} footer={selected?<div className={styles.actions}><Button variant="quiet" onPress={()=>void openHistory(selected)}><History size={14}/>History</Button><Button variant="quiet" onPress={()=>setArchiveTarget(selected)}><Archive size={14}/>Archive</Button></div>:undefined}>
      {selected&&<><p className={styles.context}>Rates are saved in {selected.content.currency}. Review and apply this template from a draft quotation’s Templates tab.</p><DataGrid ariaLabel="Template items" columns={lineColumns} data={selected.content.lines} getRowId={r=>r.id} selectable={false} pageSize={20}/><dl className={styles.summary}><div><dt>Inclusions</dt><dd>{selected.content.inclusions||'—'}</dd></div><div><dt>Exclusions</dt><dd>{selected.content.exclusions||'—'}</dd></div><div><dt>Terms</dt><dd>{selected.content.terms||'—'}</dd></div><div><dt>Payment schedule</dt><dd>{selected.content.paymentTerms.map(t=>`${t.title} (${t.percent}%)`).join(', ')||'—'}</dd></div></dl><Link className={styles.link} href="/workspace/pre-projects?section=quotations">Open quotations<ArrowUpRight size={13}/></Link></>}
    </InspectorSheet>
    <InspectorSheet isOpen={Boolean(historyTemplate)} onOpenChange={open=>{if(!open&&!busy)setHistoryTemplate(null)}} size="sm" title={historyTemplate?`${historyTemplate.name} history`:'Template history'} description="Every save is retained. Restoring creates a new revision and never deletes later history.">
      {actionError?<Callout tone="danger" title="Template history unavailable">{actionError}</Callout>:null}
      {!actionError&&!revisions.length?<p className={styles.context}>No saved changes yet.</p>:null}
      {revisions.length?<ol className={styles.historyList}>{revisions.map((revision,index)=><li key={revision.id}><div><strong>Revision {revision.revisionNumber}</strong>{index===0?<Badge tone="neutral">Current</Badge>:null}</div><small>{new Date(revision.createdAt).toLocaleString()} · {revision.changes.length} changed {revision.changes.length===1?'field':'fields'}</small>{index?<Button isDisabled={busy} onPress={()=>setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw size={14}/>Restore</Button>:null}</li>)}</ol>:null}
    </InspectorSheet>
    <ConfirmationDialog isOpen={Boolean(archiveTarget)} onOpenChange={open=>{if(!open&&!busy)setArchiveTarget(null)}} title="Archive this template?" body="It will stop appearing in quotation creation. Existing quotations and revision history stay unchanged." confirmLabel={busy?'Archiving…':'Archive template'} onConfirm={()=>void archiveTemplate()}/>
    <ConfirmationDialog isOpen={Boolean(rollbackTarget)} onOpenChange={open=>{if(!open&&!busy)setRollbackTarget(null)}} title="Restore this template revision?" body="The selected rooms, items, rates and terms will become the current template. The current version stays in history." confirmLabel={busy?'Restoring…':'Restore revision'} onConfirm={()=>void rollback()}/>
  </section>;
}
