"use client";

import Link from 'next/link';
import { ArrowUpRight, Banknote, Layers, MapPin, Package, Ruler } from 'lucide-react';
import { DataGrid, DataGridStatus, type DataGridColumn } from '@/design-system/patterns/data-grid';
import type { ProjectData, ProjectState } from '@/lib/projects/execution';
import { money } from '@/lib/commercial/client';
import { quotationDimensionsText } from '@/lib/commercial/presentation';
import styles from './project-boq.module.css';

type ScopeLine = NonNullable<ProjectData['scope']>['lines'][number];
type DeliveryCoverage = { label: string; detail: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' };
type BoqRow = ScopeLine & { quotedSize: string; deliveryCoverage: DeliveryCoverage };

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function deliveryCoverage(state: ProjectState, line: ScopeLine): DeliveryCoverage {
  const workPackage = state.data.workPackages?.find((candidate) => candidate.status !== 'cancelled' && candidate.scopeLineIds.includes(line.id));
  if (!workPackage) return { label: 'Package missing', detail: 'Released scope is not connected to a delivery package.', tone: 'warning' };
  const tasks = state.data.tasks.filter((task) => task.status !== 'cancelled' && (task.packageId === workPackage.id || (task.scopeIds ?? []).includes(line.id)));
  const completed = tasks.filter((task) => task.status === 'completed').length;
  if (['blocked', 'on_hold'].includes(workPackage.status))
    return { label: statusLabel(workPackage.status), detail: workPackage.blocker || 'Package needs review before work continues.', tone: 'danger' };
  if (tasks.some((task) => ['blocked', 'on_hold'].includes(task.status)))
    return { label: 'Task blocked', detail: `${completed} of ${tasks.length} tasks complete`, tone: 'danger' };
  if (workPackage.status === 'completed')
    return { label: 'Package complete', detail: tasks.length ? `${completed} of ${tasks.length} tasks complete` : 'Delivery package completed', tone: 'success' };
  if (!tasks.length)
    return { label: workPackage.status === 'planning' ? 'Plan package' : statusLabel(workPackage.status), detail: 'No delivery tasks linked yet', tone: workPackage.status === 'planning' ? 'warning' : 'info' };
  if (completed === tasks.length)
    return { label: 'Tasks complete', detail: `${completed} of ${tasks.length} tasks complete`, tone: 'success' };
  return { label: `${completed} of ${tasks.length} tasks`, detail: `${statusLabel(workPackage.status)} package`, tone: workPackage.status === 'planning' ? 'warning' : 'info' };
}

export function ProjectBoq({ state }: { state: ProjectState }) {
  const scope = state.data.scope;
  const quoteHref = `/workspace/pre-projects/cases/${state.caseId}/quotations${scope ? `?quote=${encodeURIComponent(scope.quoteId)}` : ''}`;
  const rows: BoqRow[] = (scope?.lines ?? []).map((line) => ({
    ...line,
    quotedSize: quotationDimensionsText(line.dimensions),
    deliveryCoverage: deliveryCoverage(state, line),
  }));
  const columns: DataGridColumn<BoqRow>[] = [
    { accessorKey: 'title', header: 'Item', size: 280, meta: { primary: true, headerIcon: <Package size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.title}>{row.original.title}</span> },
    { accessorKey: 'room', header: 'Room', size: 170, meta: { headerIcon: <MapPin size={15}/> } },
    { accessorKey: 'quotedSize', header: 'Approved size', size: 210, meta: { headerIcon: <Ruler size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.quotedSize}>{row.original.quotedSize || '—'}</span> },
    { accessorKey: 'material', header: 'Approved material', size: 340, meta: { headerIcon: <Layers size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.material}>{row.original.material || '—'}</span> },
    { id: 'quantityAndUnit', header: 'Quantity', size: 130, meta: { align: 'end' }, cell: ({row}) => `${row.original.quantity} ${row.original.unit}` },
    { id: 'deliveryCoverage', header: 'Delivery coverage', size: 210, meta: { renderCell: (row) => <span className={styles.coverage}><DataGridStatus tone={row.deliveryCoverage.tone}>{row.deliveryCoverage.label}</DataGridStatus><small>{row.deliveryCoverage.detail}</small></span> } },
    { id: 'lineTotal', header: 'Amount', size: 150, meta: { align: 'end', headerIcon: <Banknote size={15}/> }, cell: ({row}) => Number.isFinite(row.original.lineTotal) ? money(row.original.lineTotal!, scope?.currency ?? '') : '—' },
  ];
  return <section aria-label="Project bill of quantities">
    <div className={styles.summary}>
      <div><strong>{scope ? `${scope.lines.length} approved scope items` : 'No released BOQ yet'}</strong><p>{scope ? `Quotation V${scope.quoteNumber} · ${money(scope.value, scope.currency)}` : 'Approved quotation items appear here after release.'}</p></div>
      <div className={styles.summaryActions}><Link href={`/workspace/projects/${state.id}/documents`}>Scope &amp; design <ArrowUpRight size={14} aria-hidden="true"/></Link><Link href={quoteHref}>Source quotation <ArrowUpRight size={14} aria-hidden="true"/></Link></div>
    </div>
    {scope && <DataGrid ariaLabel="Project BOQ" data={rows} columns={columns} getRowId={line => line.id} selectable={false} rowNumbers={false} exportFileName="project-boq.csv" searchLabel="Search BOQ items" emptyTitle="No BOQ items" emptyDescription="No items match the current search or filters."/>}
  </section>;
}
