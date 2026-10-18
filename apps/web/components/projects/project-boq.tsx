"use client";

import Link from 'next/link';
import { ArrowUpRight, Banknote, Boxes, Layers, MapPin, Package, Ruler } from 'lucide-react';
import { quantityToSource } from '@/lib/projects/purchasing';
import { DataGrid, DataGridStatus, type DataGridColumn } from '@/design-system/patterns/data-grid';
import { StageHeader, type StageMetric } from './project-stage';
import type { Task } from '@/lib/projects/execution';
import type { ProjectData, ProjectState } from '@/lib/projects/execution';
import { money } from '@/lib/commercial/client';
import { quotationDimensionsText } from '@/lib/commercial/presentation';
import styles from './project-boq.module.css';

type ScopeLine = NonNullable<ProjectData['scope']>['lines'][number];
type DeliveryCoverage = { label: string; detail: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' };
type MaterialCoverage = { label: string; detail: string; tone: DeliveryCoverage['tone'] };
type PipelineState = 'done' | 'current' | 'attention' | 'upcoming';
type PipelineStep = { id: string; label: string; state: PipelineState };
type BoqRow = ScopeLine & { quotedSize: string; deliveryCoverage: DeliveryCoverage; materials: MaterialCoverage; pipeline: PipelineStep[] };

/** Where one quoted item stands, from release to handover. */
function linePipeline(state: ProjectState, line: ScopeLine): PipelineStep[] {
  const d = state.data;
  const tasks = (d.tasks ?? []).filter((task) => task.status !== 'cancelled' && (task.scopeIds ?? []).includes(line.id));
  const materials = (d.materials ?? []).filter((material) => material.scopeLineId === line.id);
  const orders = d.orders ?? [];
  const taskState = (list: Task[]): PipelineState => !list.length ? 'upcoming'
    : list.some((task) => ['blocked', 'on_hold'].includes(task.status)) ? 'attention'
    : list.every((task) => task.status === 'completed') ? 'done'
    : list.some((task) => task.status !== 'planned') ? 'current' : 'upcoming';
  const materialsState: PipelineState = !materials.length ? 'upcoming'
    : materials.some((material) => material.supply === 'company' && quantityToSource(material, orders) > 0) ? 'attention'
    : materials.every((material) => material.supply !== 'company' || material.movements.some((movement) => movement.kind === 'receive')) ? 'done' : 'current';
  const factory = tasks.filter((task) => task.location === 'factory');
  const site = tasks.filter((task) => task.location === 'site');
  const handedOver = (d.handovers ?? []).some((handover) => handover.status === 'accepted' && (handover.taskIds.some((id) => tasks.some((task) => task.id === id)) || (handover.area && handover.area === line.room)));
  return [
    { id: 'released', label: 'Released', state: 'done' },
    { id: 'materials', label: 'Materials', state: materialsState },
    ...(factory.length ? [{ id: 'factory', label: 'Factory', state: taskState(factory) }] : []),
    { id: 'site', label: 'Site', state: taskState(site) },
    { id: 'handover', label: 'Handed over', state: handedOver ? 'done' as const : site.length && site.every((task) => task.status === 'completed') ? 'current' as const : 'upcoming' as const },
  ];
}

function materialCoverage(state: ProjectState, line: ScopeLine): MaterialCoverage {
  const planned = (state.data.materials ?? []).filter((material) => material.scopeLineId === line.id);
  if (!planned.length) return { label: 'Not planned', detail: 'Plan materials from scope', tone: 'warning' };
  const toOrder = planned.filter((material) => material.supply === 'company' && quantityToSource(material, state.data.orders ?? []) > 0).length;
  const received = planned.filter((material) => material.movements.some((movement) => movement.kind === 'receive')).length;
  if (toOrder) return { label: `${toOrder} to order`, detail: `${planned.length} requirement${planned.length === 1 ? '' : 's'}`, tone: 'warning' };
  if (received === planned.length) return { label: 'Received', detail: `${planned.length} requirement${planned.length === 1 ? '' : 's'}`, tone: 'success' };
  return { label: 'Ordered', detail: `${planned.length} requirement${planned.length === 1 ? '' : 's'}`, tone: 'info' };
}

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
    materials: materialCoverage(state, line),
    pipeline: linePipeline(state, line),
  }));
  const columns: DataGridColumn<BoqRow>[] = [
    { accessorKey: 'title', header: 'Item', size: 280, meta: { primary: true, headerIcon: <Package size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.title}>{row.original.title}</span> },
    { id: 'pipeline', header: 'Pipeline', size: 300, enableSorting: false, meta: { renderCell: (row) => <ol className={styles.pipeline} aria-label={`Pipeline for ${row.title}`}>{row.pipeline.map((step) => <li data-state={step.state} key={step.id}><span aria-hidden="true"/>{step.label}</li>)}</ol> } },
    { accessorKey: 'room', header: 'Room', size: 170, meta: { headerIcon: <MapPin size={15}/> } },
    { accessorKey: 'quotedSize', header: 'Approved size', size: 210, meta: { headerIcon: <Ruler size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.quotedSize}>{row.original.quotedSize || '—'}</span> },
    { accessorKey: 'material', header: 'Approved material', size: 340, meta: { headerIcon: <Layers size={15}/> }, cell: ({row}) => <span className={styles.wrap} title={row.original.material}>{row.original.material || '—'}</span> },
    { id: 'quantityAndUnit', header: 'Quantity', size: 130, meta: { align: 'end' }, cell: ({row}) => `${row.original.quantity} ${row.original.unit}` },
    { id: 'materials', header: 'Materials', size: 160, meta: { headerIcon: <Boxes size={15}/>, renderCell: (row) => <span className={styles.coverage}><DataGridStatus tone={row.materials.tone}>{row.materials.label}</DataGridStatus><small>{row.materials.detail}</small></span> } },
    { id: 'deliveryCoverage', header: 'Delivery coverage', size: 210, meta: { renderCell: (row) => <span className={styles.coverage}><DataGridStatus tone={row.deliveryCoverage.tone}>{row.deliveryCoverage.label}</DataGridStatus><small>{row.deliveryCoverage.detail}</small></span> } },
    { id: 'lineTotal', header: 'Amount', size: 150, meta: { align: 'end', headerIcon: <Banknote size={15}/> }, cell: ({row}) => Number.isFinite(row.original.lineTotal) ? money(row.original.lineTotal!, scope?.currency ?? '') : '—' },
  ];
  const rooms = new Set(rows.map((line) => line.room).filter(Boolean)).size;
  const metrics: StageMetric[] = scope ? [
    { label: 'Scope items', value: scope.lines.length },
    { label: 'Rooms', value: rooms },
    { label: 'Contract value', value: money(scope.value, scope.currency) },
    { label: 'Needs planning', value: rows.filter((line) => line.deliveryCoverage.tone === 'warning').length, tone: rows.some((line) => line.deliveryCoverage.tone === 'warning') ? 'attention' : 'neutral' },
  ] : [];
  return <section aria-label="Project bill of quantities">
    <StageHeader
      action={<div className={styles.summaryActions}>{scope ? <Link href={`/workspace/projects/${state.id}/documents`}>Drawings <ArrowUpRight size={14} aria-hidden="true"/></Link> : null}<Link aria-label={scope ? "View source quotation" : "View quotations"} href={quoteHref}>{scope ? `Quotation V${scope.quoteNumber}` : 'Quotations'} <ArrowUpRight size={14} aria-hidden="true"/></Link></div>}
      description={scope ? 'The approved quotation items this project must deliver. Each line shows whether a delivery package and tasks cover it.' : 'Approved quotation items appear here after release from Pre-execution.'}
      metrics={metrics}
      readOnly
      title={scope ? 'Scope' : 'No released BOQ yet'}
    />
    {scope && <DataGrid ariaLabel="Project BOQ" data={rows} columns={columns} getRowId={line => line.id} selectable={false} rowNumbers={false} exportFileName="project-boq.csv" searchLabel="Search BOQ items" emptyTitle="No BOQ items" emptyDescription="No items match the current search or filters."/>}
  </section>;
}
