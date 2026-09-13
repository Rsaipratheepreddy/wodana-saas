"use client";
import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, Boxes, CircleDollarSign, Hash, Layers, ListFilter, Package, Pencil, Ruler, Tag, Timer } from 'lucide-react';
import { Button, DataGrid, IconMenuButton, type DataGridColumn } from '@/design-system';
import type { CatalogRecord } from '@/lib/workspace/catalog';
import { catalogAttribute, catalogHierarchy, catalogRecordName, isMaterialRequirement, materialKinds } from '@/lib/workspace/catalog-hierarchy';
import type {CatalogRelatedAction} from './catalog-entry-editor';
import { importedPrices, priceLabel, recordPrices, sourcePriceBasis } from '@/lib/workspace/catalog-prices';
import styles from './catalog-hierarchy.module.css';

export type CatalogView = 'room' | 'work' | 'variant' | 'components' | 'material' | 'products' | 'brand' | 'unit';
export function CatalogHierarchyTable({ view, rows, items, canManage, componentCounts, pricesLoading, searchValue, onSearchChange, totalRowCount, toolbarActions, footerActions, onOpen, onEdit, onPrice, onDetails, onRelated }: {
  view: CatalogView; rows: CatalogRecord[]; items: CatalogRecord[]; canManage: boolean; componentCounts?: {id:string;count:number}[]; pricesLoading?: boolean;
  searchValue: string; onSearchChange: (value: string) => void; totalRowCount: number; toolbarActions?: ReactNode; footerActions?: ReactNode;
  onDetails: (r:CatalogRecord) => void; onOpen: (r: CatalogRecord) => void; onEdit: (r: CatalogRecord) => void; onPrice: (r: CatalogRecord) => void;
  onRelated: CatalogRelatedAction;
}) {
  const graph = useMemo(() => catalogHierarchy(items), [items]);
  const linkedCount = (r: CatalogRecord, count: number, label: string, section?: 'variant' | 'components') => <button className={styles.link} aria-label={`${label} for ${catalogRecordName(r)}`} onClick={() => section ? onRelated(r, section) : onDetails(r)}>{count} {(count===1?label.slice(0,-1):label).toLowerCase()}<ArrowUpRight size={12}/></button>;
  const materialsCount = (r: CatalogRecord) => pricesLoading ? componentCounts?.find(c => c.id === r.id)?.count ?? 0 : graph.materials(r.id).length;
  const materialTargets = (r: CatalogRecord) => r.kind === 'construction' ? graph.targets(r, materialKinds) : [r];
  const products = (r: CatalogRecord) => materialTargets(r).filter(r => !isMaterialRequirement(r));
  const productLinks = (records: CatalogRecord[]) => <div className={styles.cellLinks}>{records.map(record => <button key={record.id} className={styles.link} title={record.name} onClick={() => onOpen(record)}>{catalogRecordName(record)}<ArrowUpRight size={12}/></button>)}</div>;
  const priceText = (r: CatalogRecord) => {
    if (pricesLoading) return 'Loading…';
    const rates = recordPrices(r, items), source = importedPrices(r);
    return rates.length === 1 ? priceLabel(rates[0], items) : rates.length ? `${rates.length} prices` : source.length ? source[0].formatted : 'Not set';
  };
  const price = (r: CatalogRecord) => {
    if (pricesLoading) return <span>Loading…</span>;
    const rates = recordPrices(r, items), source = importedPrices(r);
    const value = priceText(r);
    return <button className={styles.price} onClick={() => onPrice(r)} aria-label={`Prices for ${r.name}`}><span>{value}{!rates.length && source.length ? <small>{r.kind === 'variant' ? 'Estimated cost / item' : sourcePriceBasis(source[0], r)}</small> : null}</span><Pencil size={12} aria-hidden="true" /></button>;
  };
  const columns: DataGridColumn<CatalogRecord>[] = [
    { id: 'name', header: view === 'room' ? 'Room' : view === 'work' ? 'Item' : view === 'variant' ? 'Variant' : view === 'components' ? 'Component / role' : 'Material', size: view === 'components' ? 180 : view === 'variant' ? 165 : 310, accessorFn: r => catalogRecordName(r), cell: ({ row: { original: r } }) => <button className={`${styles.name} ${styles.link}`} title={r.name} onClick={() => onOpen(r)} aria-label={`Open ${r.name}`}><strong>{catalogRecordName(r)}</strong></button> },
  ];
  if (view === 'room') columns.push(
    { id: 'items', header: 'Items', size: 100, filterFn: 'includesString', accessorFn: r => graph.related('work', 'room', r.id).length },
    { id: 'description', header: 'Description', size: 420, accessorFn: r => r.description || catalogAttribute(r, 'description') || '—' },
  );
  if (view === 'work') columns.push(
    { id: 'category', header: 'Category', size: 160, filterFn: 'equalsString', accessorFn: r => graph.names(r, 'category') || catalogAttribute(r, 'category') || 'Uncategorized', meta: { filterOptions: [...new Set(rows.map(r => graph.names(r, 'category') || catalogAttribute(r, 'category') || 'Uncategorized'))].sort().map(value => ({id:value,label:value})) } },
    { id: 'room', header: 'Room', size: 180, accessorFn: r => graph.names(r, 'room') || '—' },
    { id: 'variants', header: 'Variants', size: 130, filterFn: 'includesString', accessorFn: r => graph.related('variant', 'work', r.id).length, cell: ({row:{original:r}}) => linkedCount(r,graph.related('variant','work',r.id).length,'Variants','variant') },
    { id: 'materials', header: 'Materials', size: 145, filterFn: 'includesString', accessorFn: materialsCount, cell: ({row:{original:r}}) => linkedCount(r,materialsCount(r),'Materials','components') },
    { id: 'unit', header: 'Unit', size: 140, accessorFn: r => graph.names(r, 'unit') || '—' },
  );
  if (view === 'variant') columns.push(
    { id: 'materials', header: 'Materials', size: 140, filterFn: 'includesString', accessorFn: r => graph.materials(graph.targets(r,['work'])[0]?.id ?? '',r.id).length, cell: ({row:{original:r}}) => linkedCount(r,graph.materials(graph.targets(r,['work'])[0]?.id ?? '',r.id).length,'Materials','components') },
    { id: 'board', header: 'Board', size: 165, accessorFn: r => graph.names(r, 'material') || catalogAttribute(r, 'board_choice') || '—' },
    { id: 'finish', header: 'Finish', size: 165, accessorFn: r => graph.names(r, 'sku') || catalogAttribute(r, 'laminate_choice') || '—' },
    { id: 'hardware', header: 'Hardware', size: 150, accessorFn: r => graph.names(r, 'hardware') || catalogAttribute(r, 'hardware_choice') || '—' },
    { id: 'timeline', header: 'Days', size: 60, accessorFn: r => catalogAttribute(r, 'estimated_timeline_days') || '—' },
  );
  if (view === 'components') columns.push(
    { id: 'specification', header: 'Required specification', size: 220, accessorFn: r => graph.specification(r) || '—', cell: ({row:{original:r}}) => materialTargets(r).some(isMaterialRequirement) ? productLinks(materialTargets(r).filter(isMaterialRequirement)) : graph.specification(r) || '—' },
    { id: 'product', header: 'Selected material', size: 285, accessorFn: r => products(r).map(catalogRecordName).join(', ') || 'Not selected', cell: ({row:{original:r}}) => products(r).length ? productLinks(products(r)) : canManage ? <button className={styles.link} onClick={() => onEdit(r)} aria-label={`Select material for ${r.name}`}>Select material<ArrowUpRight size={12}/></button> : <span className={styles.context}>Not selected</span> },
    { id: 'quantity', header: 'Quantity', size: 120, accessorFn: r => catalogAttribute(r, 'quantity') ?? '—' },
    { id: 'unit', header: 'Unit', size: 150, accessorFn: r => graph.names(r, 'unit') || catalogAttribute(r, 'unit') || '—' },
    { id: 'required', header: 'Required', size: 120, accessorFn: r => r.configuration?.required === 'optional' ? 'Optional' : r.configuration?.required === 'conditional' ? 'Conditional' : 'Required' },
    { id: 'scope', header: 'Applies to', size: 150, accessorFn: r => graph.targets(r,['variant']).map(catalogRecordName).join(', ') || 'All variants' },
  );
  if (view === 'material' || view === 'products') columns.push(
    { id: 'code', header: 'Code', size: 110, accessorFn: r => r.code },
    { id: 'category', header: 'Category', size: 170, accessorFn: r => graph.names(r, 'category') || catalogAttribute(r, 'category') || graph.names(r, 'material') || '—' },
    { id: 'brand', header: 'Brand', size: 170, accessorFn: r => graph.names(r, 'brand') || catalogAttribute(r, 'brand_name') || '—' },
    { id: 'unit', header: 'Unit', size: 140, accessorFn: r => graph.names(r, 'unit') || '—' },
    { id: 'usage', header: 'Used in', size: 120, filterFn: 'includesString', accessorFn: r => new Set(graph.usage(r.id).map(u=>u.item.id)).size, cell: ({row:{original:r}}) => linkedCount(r,new Set(graph.usage(r.id).map(u=>u.item.id)).size,'Items') },
  );
  if (view === 'unit') columns.push({ id: 'dimension', header: 'Measurement', size: 170, accessorFn: r => r.dimension === 'pack' ? 'Product-specific pack' : r.dimension }, { id: 'factor', header: 'Base factor', size: 180, accessorFn: r => r.baseFactor ?? 'Product-specific' });
  if (['work', 'variant', 'material', 'products'].includes(view)) columns.push({ id: 'price', header: view === 'variant' ? 'Cost / price' : 'Price', size: view === 'variant' ? 175 : 210, accessorFn: priceText, cell: ({ row: { original: r } }) => price(r) });
  columns.push({ id: 'actions', header: 'Action', size: 85, enableSorting: false, enableColumnFilter: false, cell: ({ row: { original: r } }) => <div className={styles.rowActions}>{canManage && <Button size="compact" variant="quiet" aria-label={`Edit ${r.name}`} onPress={() => onEdit(r)}><Pencil size={14} /></Button>}<IconMenuButton ariaLabel={`Actions for ${r.name}`} items={[{id:"details",label:"View details"}]} onAction={() => onDetails(r)} /></div> });
  const headerIcons: Record<string, ReactNode> = { name: <Package size={14}/>, variants: <Boxes size={14}/>, materials: <Layers size={14}/>, category: <ListFilter size={14}/>, room: <Boxes size={14}/>, unit: <Ruler size={14}/>, price: <CircleDollarSign size={14}/>, board: <Layers size={14}/>, finish: <Layers size={14}/>, hardware: <Package size={14}/>, timeline: <Timer size={14}/>, brand: <Tag size={14}/>, quantity: <Hash size={14}/> };
  for (const column of columns) column.meta = { ...column.meta, headerIcon: headerIcons[column.id ?? ''] };
  const label = view === 'components' ? 'Item materials' : view === 'products' ? 'Materials' : view === 'work' ? 'Items' : view === 'room' ? 'Rooms' : view === 'variant' ? 'Variants' : view === 'material' ? 'Material master' : view === 'brand' ? 'Brands' : 'Units';
  return <DataGrid ariaLabel={label} data={rows} columns={columns} getRowId={r => r.id} onRowAction={onOpen}
    initialColumnVisibility={view === 'work' ? {category:false,room:false} : {}} pageSize={50}
    searchLabel={`Search ${label.toLowerCase()}`} searchValue={searchValue} onSearchChange={onSearchChange} totalRowCount={totalRowCount}
    exportFileName={`master-data-${label.toLowerCase().replaceAll(' ', '-')}.csv`} toolbarActions={toolbarActions} footerActions={footerActions}
    emptyTitle="No records found" emptyDescription="Try another search or add a record." />;
}
