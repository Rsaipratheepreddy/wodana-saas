"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {ArrowUpRight, FileText, Plus} from 'lucide-react';
import {Button, Callout, DataGrid, InspectorSheet, type DataGridColumn} from '@/design-system';
import type {QuotationTemplate, QuoteLine} from '@/lib/commercial/types';
import {money} from '@/lib/commercial/client';
import styles from '../workspace/catalog-hierarchy.module.css';
import theme from '../crm/crm-workspace-colors.module.css';

export function QuotationTemplatesPage({items,error}:{items:QuotationTemplate[];error?:string}) {
  const router=useRouter();
  const [selected,setSelected]=useState<QuotationTemplate|null>(null);
  const columns:DataGridColumn<QuotationTemplate>[]=[
    {id:'name',header:'Template',size:300,accessorKey:'name',meta:{headerIcon:<FileText size={14}/>},cell:({row:{original:r}})=><button className={styles.link} onClick={()=>setSelected(r)}>{r.name}<ArrowUpRight size={13}/></button>},
    {id:'rooms',header:'Rooms',size:270,accessorFn:r=>[...new Set(r.content.lines.map(l=>l.room))].join(', ')},
    {id:'items',header:'Items',size:95,accessorFn:r=>r.content.lines.length},
    {id:'currency',header:'Currency',size:105,accessorFn:r=>r.content.currency},
    {id:'updated',header:'Updated',size:150,accessorFn:r=>new Date(r.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})},
  ];
  const lineColumns:DataGridColumn<QuoteLine>[]=[{accessorKey:'title',header:'Item',size:240},{accessorKey:'room',header:'Room',size:160},{accessorKey:'quantity',header:'Quantity',size:100},{accessorKey:'unit',header:'Unit',size:100},{id:'rate',header:'Rate',size:140,accessorFn:r=>money(r.rate,selected?.content.currency)}];
  return <section className={`${styles.page} ${theme.theme}`} aria-label="Quotation Templates workspace">
    <header className={styles.header}><h1>Quotation Templates</h1><Link className={styles.link} href="/workspace/pre-projects?section=quotations"><Plus size={15}/>Create from a quotation<ArrowUpRight size={13}/></Link></header>
    <p className={styles.context}>Save a quotation as a template to reuse its rooms, items, materials, rates and terms.</p>
    {error?<Callout tone="danger" title="Templates could not be loaded" actions={<Button onPress={()=>router.refresh()}>Try again</Button>}>{error}</Callout>:<DataGrid ariaLabel="Quotation Templates" columns={columns} data={items} getRowId={r=>r.id} searchLabel="Search quotation templates" onRowAction={r=>setSelected(r)} emptyTitle="No quotation templates yet" emptyDescription="Open a quotation and choose Templates to save it for reuse." exportFileName="quotation-templates.csv"/>}
    <InspectorSheet isOpen={Boolean(selected)} onOpenChange={open=>{if(!open)setSelected(null)}} size="lg" title={selected?.name || 'Quotation template'}>
      {selected&&<><p className={styles.context}>Rates are saved in {selected.content.currency}. Review and apply this template from a draft quotation’s Templates tab.</p><DataGrid ariaLabel="Template items" columns={lineColumns} data={selected.content.lines} getRowId={r=>r.id} selectable={false} pageSize={20}/><dl className={styles.summary}><div><dt>Inclusions</dt><dd>{selected.content.inclusions||'—'}</dd></div><div><dt>Exclusions</dt><dd>{selected.content.exclusions||'—'}</dd></div><div><dt>Terms</dt><dd>{selected.content.terms||'—'}</dd></div><div><dt>Payment schedule</dt><dd>{selected.content.paymentTerms.map(t=>`${t.title} (${t.percent}%)`).join(', ')||'—'}</dd></div></dl><Link className={styles.link} href="/workspace/pre-projects?section=quotations">Open quotations<ArrowUpRight size={13}/></Link></>}
    </InspectorSheet>
  </section>;
}
