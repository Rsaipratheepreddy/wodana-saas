"use client";

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Button, ControlledModalDialog, DataGrid, DesignSystemProvider, SearchInput, TextAreaField, TextInput, type DataGridColumn, useDesignSystem } from '@/design-system';
import { catalogAttribute } from '@/lib/workspace/catalog-hierarchy';
import type { CatalogPageData } from '@/lib/workspace/catalog';
import styles from './catalog-collection-index.module.css';

type CatalogRow = { id: string; name: string; description: string; isDefault: boolean; rooms: number; items: number; materials: number; brands: number; units: number };
const detailHref = (id: string) => `/workspace/catalogs?catalogId=${encodeURIComponent(id)}`;

export function CatalogCollectionIndex({ initialData }: { initialData: CatalogPageData }) {
  const inherited = useDesignSystem();
  const router = useRouter();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const rows = useMemo<CatalogRow[]>(() => {
    const count = (catalogId: string, kinds: string[]) => initialData.catalogCounts
      ? initialData.catalogCounts.filter(row => row.catalogId === catalogId && kinds.includes(row.kind)).reduce((total, row) => total + row.count, 0)
      : initialData.items.filter(row => row.catalogId === catalogId && !row.archived && kinds.includes(row.kind)).length;
    return initialData.items.filter(row => row.kind === 'catalog_group' && !row.archived).map(row => ({
      id: row.id, name: row.name, description: row.description,
      isDefault: catalogAttribute(row, 'Default catalog') === 'true',
      rooms: count(row.id, ['room']), items: count(row.id, ['work']),
      materials: count(row.id, ['material', 'sku', 'hardware', 'consumable']),
      brands: count(row.id, ['brand']), units: count(row.id, ['unit']),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [initialData]);
  const visible = rows.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const columns = useMemo<DataGridColumn<CatalogRow>[]>(() => [
    { accessorKey: 'name', header: 'Catalog', size: 300, meta: {primary: true}, cell: ({row}) => <span className={styles.name}><strong>{row.original.name}</strong>{row.original.isDefault && <small>Default</small>}</span> },
    { accessorKey: 'rooms', header: 'Rooms', size: 92, meta: {align: 'end'} },
    { accessorKey: 'items', header: 'Items', size: 92, meta: {align: 'end'} },
    { accessorKey: 'materials', header: 'Materials', size: 108, meta: {align: 'end'} },
    { accessorKey: 'brands', header: 'Brands', size: 92, meta: {align: 'end', mobileHidden: true} },
    { accessorKey: 'units', header: 'Units', size: 92, meta: {align: 'end', mobileHidden: true} },
    { id: 'open', header: '', size: 72, cell: ({row}) => <Link aria-label={`Open ${row.original.name}`} className={styles.open} href={detailHref(row.original.id)}>Open <ArrowUpRight size={13} /></Link> },
  ], []);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/workspace/catalog/collections?workspaceId=${initialData.workspaceId}`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({id: crypto.randomUUID(), name: name.trim(), description: description.trim(), starter: false}),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(result?.message) ? result.message.join('. ') : result?.message ?? 'Catalog could not be created.');
      setCreating(false);
      router.push(detailHref(result.id));
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Catalog could not be created.'); }
    finally { setSaving(false); }
  };
  return <DesignSystemProvider {...inherited} currency={initialData.currency ?? inherited.currency} portalContainer={portal}>
    <div ref={setPortal} className={styles.page} aria-label="Catalogs">
      {initialData.error && <p role="alert" className={styles.error}>{initialData.error}</p>}
      {!initialData.error && <><div className={styles.toolbar}><SearchInput label="Search catalogs" placeholder="Search catalogs…" value={query} onChange={setQuery} />{initialData.canManage && <Button variant="primary" size="compact" onPress={() => { setName(''); setDescription(''); setError(''); setCreating(true); }}><Plus size={15} />New catalog</Button>}</div>
        <DataGrid appearance="contained" ariaLabel="Catalogs table" columns={columns} data={visible} getRowId={row => row.id} onRowAction={row => router.push(detailHref(row.id))} selectable={false} showToolbar={false} emptyTitle={query ? 'No matching catalogs' : 'No catalogs yet'} emptyDescription={query ? 'Try a different search.' : 'Create a catalog to organize your shared records.'} pageSize={25} />
      </>}
      <ControlledModalDialog isOpen={creating} onOpenChange={open => { if (!saving) setCreating(open); }} title="New catalog" description="Create a separate collection. Existing catalogs stay unchanged." footer={<div className={styles.actions}><Button isDisabled={saving} onPress={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" form="create-catalog" isLoading={saving}>Create catalog</Button></div>}>
        <form id="create-catalog" onSubmit={event => void create(event)} className={styles.form}>
          <TextInput label="Catalog name" isRequired value={name} onChange={setName} maxLength={180} autoFocus />
          <TextAreaField label="Description" value={description} onChange={setDescription} maxLength={4000} />
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </form>
      </ControlledModalDialog>
    </div>
  </DesignSystemProvider>;
}
