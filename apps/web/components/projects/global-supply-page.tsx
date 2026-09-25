"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Callout, DataGrid, SearchInput, type DataGridColumn } from '@/design-system';
import type { SupplyQueuePage, SupplyQueueRow } from '../../../../services/business-core/src/projects/project-supply-queue';
import type { WarehouseStock } from '../../../../services/business-core/src/projects/project-stock.types';
import styles from './global-supply-page.module.css';

const emptyPage: SupplyQueuePage = { rows: [], stock: [], canBuy: false, canViewInventory: false };
type SupplyView = 'shortage' | 'order';
const views: { id: SupplyView; label: string }[] = [
  { id: 'shortage', label: 'Materials' }, { id: 'order', label: 'Orders' },
];

function orderState(row: SupplyQueueRow) {
  if (row.kind === 'order' && row.pendingInspection) return <Badge tone="warning">Inspection pending</Badge>;
  if (row.kind === 'order' && row.status === 'acknowledged' && row.quantity === 0) return <Badge tone="success">Ready to close</Badge>;
  const { status } = row;
  const labels: Record<string, string> = { enquiry: 'Quote requested', draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', acknowledged: 'Supplier confirmed' };
  const tone = status === 'approved' ? 'success' : status === 'acknowledged' ? 'info' : status === 'submitted' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{labels[status] ?? status.replaceAll('_', ' ')}</Badge>;
}

function orderSummary(row: SupplyQueueRow) {
  if (row.kind === 'enquiry') return `${row.quantity} ${row.unit} requested`;
  if (row.orderedQuantity == null) return `${row.quantity} ${row.unit} remaining`;
  const accepted = row.orderedQuantity - row.quantity;
  return `${accepted} of ${row.orderedQuantity} ${row.unit} accepted${row.pendingInspection ? ` · ${row.pendingInspection} pending inspection` : ''}`;
}

function actionLabel(row: SupplyQueueRow, view: SupplyView, canBuy: boolean) {
  if (view === 'shortage') return canBuy ? 'Source material' : 'View material';
  if (row.kind === 'enquiry') return 'Review quote';
  if (row.pendingInspection) return 'View inspection';
  if (row.status === 'acknowledged' && row.quantity === 0 && canBuy) return 'Close order';
  return 'Open order';
}

function demandForStock(rows: SupplyQueueRow[], item: WarehouseStock) {
  return rows.find(row => row.kind === 'shortage' && Boolean(item.catalogId) && row.catalogId === item.catalogId && row.catalogVersion === item.catalogVersion && row.unit === item.unit);
}

type GlobalSupplyPageProps = {
  workspaceId: string; initial?: SupplyQueuePage; initialError?: string; mode: 'purchasing' | 'inventory'; view?: SupplyView; initialSearch?: string;
};

export function GlobalSupplyPage(props: GlobalSupplyPageProps) {
  const { workspaceId, mode, view = 'shortage', initialSearch = '' } = props;
  return <GlobalSupplyPageContent key={`${workspaceId}:${mode}:${view}:${initialSearch}`} {...props} />;
}

function GlobalSupplyPageContent({ workspaceId, initial = emptyPage, initialError = '', mode, view = 'shortage', initialSearch = '' }: GlobalSupplyPageProps) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(initialSearch);
  const refresh = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/supply-queue?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error('Supply records could not be loaded. Check your access and retry.');
      const next = await response.json() as SupplyQueuePage;
      if (!Array.isArray(next.rows) || !Array.isArray(next.stock)) throw new Error('The supply response was incomplete. Retry.');
      setData(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Supply records could not be loaded.'); }
    finally { setBusy(false); }
  };
  const term = search.trim().toLocaleLowerCase();
  const rows = useMemo(() => data.rows.filter(row => (view === 'shortage' ? row.kind === 'shortage' : row.kind !== 'shortage') && (!term || `${row.title} ${row.projectName} ${row.supplier} ${row.status}`.toLocaleLowerCase().includes(term))), [data.rows, view, term]);
  const stock = useMemo(() => data.stock.filter(row => !term || `${row.title} ${row.location}`.toLocaleLowerCase().includes(term)), [data.stock, term]);
  const supplyColumns = useMemo<DataGridColumn<SupplyQueueRow>[]>(() => [
    { accessorKey: 'title', header: view === 'shortage' ? 'Material' : 'Item', size: 330, meta: { primary: true }, cell: ({row}) => <span className={styles.itemCell}><Link className={styles.record} href={row.original.href}>{row.original.title}</Link>{view === 'order' ? <small>{orderSummary(row.original)}</small> : null}</span> },
    { accessorKey: 'projectName', header: 'Project', size: 210 },
    ...(view === 'order' ? [{ accessorKey: 'supplier', header: 'Supplier', size: 180, cell: ({row}) => row.original.supplier || '—' }] as DataGridColumn<SupplyQueueRow>[] : []),
    { accessorKey: 'dueDate', header: view === 'shortage' ? 'Needed by' : 'Delivery', size: 130, cell: ({row}) => row.original.dueDate || '—' },
    ...(view === 'shortage' ? [{ accessorKey: 'quantity', header: 'To order', size: 125, meta: { align: 'end' }, cell: ({row}) => <strong className={styles.attentionQty}>{row.original.quantity} {row.original.unit}</strong> }] as DataGridColumn<SupplyQueueRow>[] : [{ accessorKey: 'status', header: 'State', size: 145, cell: ({row}) => orderState(row.original) }] as DataGridColumn<SupplyQueueRow>[]),
    { id: 'action', header: '', size: 120, cell: ({row}) => <Link className={styles.action} href={row.original.href}>{actionLabel(row.original, view, data.canBuy)}</Link> },
  ], [view, data.canBuy]);
  const stockColumns = useMemo<DataGridColumn<WarehouseStock>[]>(() => [
    { accessorKey: 'title', header: 'Item', size: 300, meta: { primary: true } },
    { accessorKey: 'location', header: 'Location', size: 200 },
    { id: 'available', header: 'Available', size: 145, meta: { align: 'end' }, accessorFn: row => row.quantity - row.reserved, cell: ({row}) => `${row.original.quantity - row.original.reserved} ${row.original.unit}` },
    { id: 'state', header: 'State', size: 145, accessorFn: row => row.quantity - row.reserved > 0 ? 'Available' : row.quantity > 0 ? 'Reserved' : 'Out of stock', cell: ({row}) => <Badge tone={row.original.quantity - row.original.reserved > 0 ? 'success' : row.original.quantity > 0 ? 'warning' : 'danger'}>{row.original.quantity - row.original.reserved > 0 ? 'Available' : row.original.quantity > 0 ? 'Reserved' : 'Out of stock'}</Badge> },
    { id: 'action', header: '', size: 125, cell: ({row}) => {
      const demand = demandForStock(data.rows, row.original);
      return demand ? <Link className={styles.action} href={demand.href}>Open demand</Link> : '—';
    } },
  ], [data.rows]);
  return <section className={styles.page} aria-label={mode === 'purchasing' ? 'Purchasing' : 'Inventory'}>
    {mode === 'purchasing' && <nav className={styles.views} aria-label="Purchasing views">{views.map(item => <Link key={item.id} href={`/workspace/projects/purchasing?view=${item.id}`} aria-current={item.id === view ? 'page' : undefined}>{item.label}<span>{data.rows.filter(row => item.id === 'shortage' ? row.kind === 'shortage' : row.kind !== 'shortage').length}</span></Link>)}</nav>}
    {error && <Callout title="Could not refresh supply records" tone="warning"><div className={styles.error}>{error}<Button size="compact" onPress={() => void refresh()} isDisabled={busy}>Retry</Button></div></Callout>}
    {mode === 'inventory' && !data.canViewInventory && !error ? <p className={styles.notice}>Inventory is available to purchasing and project managers.</p> : <>
      <div className={styles.toolbar}><SearchInput label={mode === 'inventory' ? 'Search inventory' : 'Search purchasing'} placeholder={mode === 'inventory' ? 'Search stock…' : 'Search projects or records…'} value={search} onChange={setSearch}/><Button size="compact" variant="quiet" onPress={() => void refresh()} isDisabled={busy}><RefreshCw size={14}/>{busy ? 'Refreshing…' : 'Refresh'}</Button></div>
      {mode === 'purchasing' ? <DataGrid appearance="contained" wrapText ariaLabel="Cross-project purchasing" columns={supplyColumns} data={rows} getRowId={row => row.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} emptyTitle={term ? 'No matching records' : view === 'shortage' ? 'No materials to order' : 'No open orders or quotes'} emptyDescription={term ? 'Try a different search.' : view === 'shortage' ? 'Uncovered materials will appear here.' : 'Supplier requests and orders will appear here.'}/>
        : <DataGrid appearance="contained" wrapText ariaLabel="Workspace inventory" columns={stockColumns} data={stock} getRowId={row => row.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} emptyTitle={term ? 'No matching stock' : 'No warehouse stock yet'} emptyDescription={term ? 'Try a different search.' : 'Accepted warehouse receipts and transfers will appear here.'}/>} 
    </>}
  </section>;
}
