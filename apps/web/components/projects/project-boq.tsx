"use client";

import Link from 'next/link';
import { ArrowUpRight, Layers, MapPin, Package, Ruler } from 'lucide-react';
import { DataGrid, type DataGridColumn } from '@/design-system/patterns/data-grid';
import type { ProjectData, ProjectState } from '@/lib/projects/execution';
import { money } from '@/lib/commercial/client';
import styles from './project-boq.module.css';

type ScopeLine = NonNullable<ProjectData['scope']>['lines'][number];
const columns: DataGridColumn<ScopeLine>[] = [
  { accessorKey: 'title', header: 'Item', size: 300, meta: { headerIcon: <Package size={15}/> } },
  { accessorKey: 'room', header: 'Room', size: 190, meta: { headerIcon: <MapPin size={15}/> } },
  { accessorKey: 'material', header: 'Material / specification', size: 320, meta: { headerIcon: <Layers size={15}/> }, cell: ({row}) => row.original.material || '—' },
  { accessorKey: 'quantity', header: 'Quantity', size: 130, meta: { align: 'end', headerIcon: <Ruler size={15}/> } },
  { accessorKey: 'unit', header: 'Unit', size: 100 },
];

export function ProjectBoq({ state }: { state: ProjectState }) {
  const scope = state.data.scope;
  const quoteHref = `/workspace/pre-projects/cases/${state.caseId}/quotations${scope ? `?quote=${encodeURIComponent(scope.quoteId)}` : ''}`;
  return <section aria-label="Project bill of quantities">
    <div className={styles.summary}>
      <div><strong>{scope ? `${scope.lines.length} scope items` : 'No released BOQ yet'}</strong><p>{scope ? `Quotation V${scope.quoteNumber} · ${money(scope.value, scope.currency)}` : 'The approved items will appear here when the quotation is released to this project.'}</p></div>
      <Link href={quoteHref}>View {scope ? 'source quotation' : 'quotations'} <ArrowUpRight size={14} aria-hidden="true"/></Link>
    </div>
    {scope && <DataGrid ariaLabel="Project BOQ" data={scope.lines} columns={columns} getRowId={line => line.id} selectable={false} rowNumbers pinFirstColumn exportFileName="project-boq.csv" searchLabel="Search BOQ items" emptyTitle="No BOQ items" emptyDescription="No items match the current search or filters."/>}
  </section>;
}
