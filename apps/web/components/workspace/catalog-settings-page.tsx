"use client";
import { useEffect, useMemo, useCallback, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Table2, Upload, Download } from 'lucide-react';
import { Button, ConfirmationDialog, DesignSystemProvider, IconMenuButton, InspectorSheet, SearchInput, SelectField, Checkbox, useDesignSystem } from '@/design-system';
import { blankCatalogRecord, savePayload, type CatalogKind, type CatalogPageData, type CatalogRecord } from '@/lib/workspace/catalog';
import { catalogAttribute, catalogHierarchy, catalogRecordName, defaultCatalog, isMaterialEntry, materialKinds } from '@/lib/workspace/catalog-hierarchy';
import { recordCode } from '@/lib/workspace/catalog-navigation';
import { catalogIssues } from '@/lib/workspace/catalog-review';
import { priceableKinds } from '@/lib/workspace/catalog-prices';
import { CatalogHierarchyTable, type CatalogView } from './catalog-hierarchy-table';
import { CatalogRoomGrid } from './catalog-room-grid';
const CatalogEditor = dynamic(() => import('./catalog-editor').then(module => module.CatalogEditor), { loading: () => <p role="status">Loading…</p> });
const CatalogEntryEditor = dynamic(() => import('./catalog-entry-editor').then(module => module.CatalogEntryEditor), { loading: () => <p role="status">Loading…</p> });
const CatalogRecordDetails = dynamic(() => import('./catalog-record-details').then(module => module.CatalogRecordDetails), { loading: () => <p role="status">Loading…</p> });
const CatalogPriceDialog = dynamic(() => import('./catalog-price-dialog').then(module => module.CatalogPriceDialog), { loading: () => <p role="status">Loading…</p> });
const CatalogImportDialog = dynamic(() => import('./catalog-import-dialog').then(module => module.CatalogImportDialog), { loading: () => <p role="status">Loading…</p> });
const CatalogSheet = dynamic(() => import('./catalog-sheet').then(module => module.CatalogSheet), { loading: () => <p role="status">Loading…</p> });
import workspaceColors from '../crm/crm-workspace-colors.module.css';
import styles from './catalog-hierarchy.module.css';

export const marketLabels: Record<string, string> = { IN: 'India', AE: 'UAE', GLOBAL: 'International', CUSTOM: 'Workspace' };
const viewLabels: Record<CatalogView, string> = { room: 'Rooms', work: 'Items', variant: 'Variants', components: 'Materials', material: 'Material master', products: 'Materials', brand: 'Brands', unit: 'Units' };
const singular: Record<CatalogView, string> = { room: 'room', work: 'item', variant: 'variant', components: 'material', material: 'material master', products: 'material', brand: 'brand', unit: 'unit' };
async function requestCatalog(workspaceId: string, path = '', method = 'GET', body?: unknown, catalog?: string) {
  const response = await fetch(`/api/workspace/catalog${path}?workspaceId=${workspaceId}${catalog ? `&catalogId=${catalog}` : ''}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message ?? 'Could not save. Your changes are still available.');
  return payload;
}
export function CatalogSettingsPage({ initialData, initialCatalogId, initialView = 'room' }: { initialData: CatalogPageData; initialCatalogId?: string; initialView?: 'room' | 'work' | 'products' }) {
  const inherited = useDesignSystem();
  const router = useRouter();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [data, setData] = useState(initialData);
  const [catalogId, setCatalogId] = useState(() => initialData.items.some(row => row.kind === 'catalog_group' && !row.archived && row.id === initialCatalogId) ? initialCatalogId! : defaultCatalog(initialData.items)?.id ?? '');
  const [loadedCatalogs, setLoadedCatalogs] = useState(() => new Set(initialData.overview ? [] : initialData.items.filter(r => r.kind === 'catalog_group').map(r => r.id)));
  const [failedCatalog, setFailedCatalog] = useState('');
  const [loadRetry, setLoadRetry] = useState(0);
  const [view, setView] = useState<CatalogView>(initialView);
  const [roomId, setRoomId] = useState(''), [itemId, setItemId] = useState(''), [variantId, setVariantId] = useState('');
  const [archived, setArchived] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CatalogRecord | null>(null), [draft, setDraft] = useState<CatalogRecord | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [priceTarget, setPriceTarget] = useState<CatalogRecord | null>(null), [priceSourceKey, setPriceSourceKey] = useState<string>();
  const [editingTable, setEditingTable] = useState(false), [sheetDirty, setSheetDirty] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null), [importOpen, setImportOpen] = useState(false);
  const items = useMemo(() => data.items.filter(r => r.catalogId === catalogId), [data.items, catalogId]);
  const catalogs = useMemo(() => data.items.filter(r => r.kind === 'catalog_group' && !r.archived), [data.items]);
  const graph = useMemo(() => catalogHierarchy(items, archived), [items, archived]);
  const activeCatalog = data.items.find(r => r.id === catalogId), room = graph.byId.get(roomId), item = graph.byId.get(itemId), variant = graph.byId.get(variantId);
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(selected));
  useEffect(() => {
    if (!dirty && !sheetDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, sheetDirty]);
  useEffect(() => {
    if (!catalogId || loadedCatalogs.has(catalogId)) return;
    let current = true;
    requestCatalog(data.workspaceId, '', 'GET', undefined, catalogId).then(next => {
      if (!current) return;
      setLoadedCatalogs(previous => new Set(previous).add(catalogId));
      setData(previous => ({ ...next, items: [...previous.items.filter(r => r.catalogId !== catalogId && r.kind !== 'catalog_group'), ...next.items] }));
    }).catch(e => { if (current) { setFailedCatalog(catalogId); setError(e instanceof Error ? e.message : 'Could not load master data.'); } });
    return () => { current = false; };
  }, [catalogId, data.workspaceId, loadRetry, loadedCatalogs]);
  const selectedCatalogReady = !catalogId || loadedCatalogs.has(catalogId);
  const catalogReady = selectedCatalogReady;
  const loading = !catalogReady && failedCatalog !== catalogId;
  const report = (e: unknown) => setError(e instanceof Error ? e.message : 'The request could not be completed.');
  const upsert = (record: CatalogRecord) => setData(d => ({ ...d, items: [...d.items.filter(r => r.id !== record.id), record] }));
  const write = (record: CatalogRecord): Promise<CatalogRecord> => requestCatalog(data.workspaceId, '/records', 'PUT', savePayload(record));
  const refresh = async () => { setError(''); try { const next = await requestCatalog(data.workspaceId, '', 'GET', undefined, catalogId); setLoadedCatalogs(previous => new Set(previous).add(catalogId)); if (!catalogId) setCatalogId(defaultCatalog(next.items)?.id ?? ''); setData(previous => ({...next, items:[...previous.items.filter(r => r.catalogId !== catalogId && r.kind !== 'catalog_group'), ...next.items]})); } catch (e) { report(e); } };
  const changeView = (next: CatalogView, nextRoom = '', nextItem = '', nextVariant = '', nextCatalog = catalogId) => {
    const action = () => { setFailedCatalog(''); setArchived(false); setReviewOnly(false); setView(next); setRoomId(nextRoom); setItemId(nextItem); setVariantId(nextVariant); setCatalogId(nextCatalog); setSearch(''); setCategory('all'); setPage(1); setEditingTable(false); setSheetDirty(false); setError(''); setMessage(''); };
    if (sheetDirty) setDiscard(() => action); else action();
  };
  const open = (record: CatalogRecord) => {
    if (sheetDirty) { setError('Save or undo your table changes first.'); return; }
    if (!catalogReady && !['room','work','variant'].includes(record.kind)) return;
    if (record.archived) { setSelected(record); setDraft(null); return; }
    if (record.kind === 'room') changeView('work', record.id);
    else if (record.kind === 'work') changeView('variant', record.links.some(l => l.relation === 'room' && l.targetId === roomId) ? roomId : record.links.find(l => l.relation === 'room')?.targetId || '', record.id);
    else if (record.kind === 'variant') {
      const owner = graph.targets(record, ['work'])[0];
      changeView('components', owner?.links.some(l => l.relation === 'room' && l.targetId === roomId) ? roomId : owner ? graph.targets(owner,['room'])[0]?.id || '' : '', owner?.id || '', record.id);
    }
    else { setSelected(record); setDraft(null); setError(''); }
  };
  const edit = (record: CatalogRecord) => { setSelected(record.version ? record : null); setDraft(structuredClone(record)); setError(''); };
  const close = () => { if (!saving) { setSelected(null); setDraft(null); setError(''); } };
  const price = (record: CatalogRecord, key?: string) => { setPriceSourceKey(key); setPriceTarget(record); };
  const related = (record: CatalogRecord, section?: 'variant' | 'components') => {
    const action = () => {
      setDraft(null); setSelected(null);
      const owner = record.kind === 'work' ? record : graph.targets(record, ['work'])[0];
      if (section && owner) changeView(section, graph.targets(owner,['room'])[0]?.id || '', owner.id, record.kind === 'variant' && section === 'components' ? record.id : '');
      else open(record);
    };
    if (dirty) setDiscard(() => action); else action();
  };
  const activeGraph = graph;
  const viewItems = items;
  const sourceRows = useMemo(() => {
    if (view === 'work') return room ? graph.related('work', 'room', room.id) : graph.active.filter(r => r.kind === 'work');
    if (view === 'variant') return item ? graph.related('variant', 'work', item.id) : [];
    if (view === 'components') return item ? graph.materials(item.id, variant?.id) : [];
    if (view === 'products') return activeGraph.active.filter(isMaterialEntry);
    if (view === 'material') return graph.active.filter(r => r.kind === 'material' && !['family', 'component specification'].includes(catalogAttribute(r, 'Catalog role') ?? '') && !catalogAttribute(r, 'Import role'));
    return graph.active.filter(r => r.kind === view);
  }, [view, graph, activeGraph, room, item, variant]);
  const categoryOf = useCallback((record: CatalogRecord) => activeGraph.names(record, 'category') || catalogAttribute(record, 'category') || activeGraph.names(record, 'material') || '', [activeGraph]);
  const reviewRows = useMemo(() => view === 'products' && catalogReady && !archived ? sourceRows.map(record => ({ record, issues: catalogIssues(record, data.items) })).filter(entry => entry.issues.length) : [], [view, catalogReady, archived, sourceRows, data.items]);
  const reviewIds = useMemo(() => new Set(reviewRows.map(entry => entry.record.id)), [reviewRows]);
  const categories = [...new Set(sourceRows.map(categoryOf).filter(Boolean))].sort();
  const filtered = useMemo(() => sourceRows.filter(r => (!reviewOnly || view !== 'products' || archived || reviewIds.has(r.id)) && (category === 'all' || categoryOf(r) === category) && (!search.trim() || [r.name, r.code, ...r.aliases, ...r.attributes.map(a => a.value), ...r.links.map(l => activeGraph.byId.get(l.targetId)?.name ?? '')].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => catalogRecordName(a).localeCompare(catalogRecordName(b))), [sourceRows, category, search, activeGraph, categoryOf, reviewOnly, reviewIds, view, archived]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const recordKind: CatalogKind = view === 'products' ? 'sku' : view === 'components' ? 'construction' : view;
  const makeRecord = (): CatalogRecord => ({ ...blankCatalogRecord(recordKind), catalogId: catalogId || undefined, links: [
    ...(view === 'work' && room ? [{ relation: 'room', targetId: room.id }] : []),
    ...(view === 'variant' && item ? [{ relation: 'work', targetId: item.id }, ...item.links.filter(l => l.relation === 'unit')] : []),
  ] });
  const addComponent = async (parent: CatalogRecord) => {
    const owner = parent.kind === 'work' ? parent : graph.byId.get(parent.links.find(l => l.relation === 'work')?.targetId ?? '');
    if (!owner) { setError('Choose an item for this material.'); return; }
    setSaving(true); setError('');
    try {
      let template = graph.related('construction', 'work', owner.id).find(r => r.configuration?.recordRole === 'template');
      if (!template) {
        const created = { ...blankCatalogRecord('construction'), catalogId, name: `${catalogRecordName(owner)} materials`.slice(0, 180), configuration: { recordRole: 'template' }, links: [{ relation: 'work', targetId: owner.id }] };
        created.code = recordCode(created.name, created.id); template = await write(created); upsert(template);
      }
      edit({ ...blankCatalogRecord('construction'), catalogId, attributes: [{name:'Quantity',value:'1'}], configuration: { recordRole: 'component', required: 'required' }, links: [{ relation: 'parent', targetId: template.id }, { relation: 'work', targetId: owner.id }, ...(variant ? [{ relation: 'variant', targetId: variant.id }] : [])] });
    } catch (e) { report(e); } finally { setSaving(false); }
  };
  const add = () => view === 'components' && item ? addComponent(item) : edit(makeRecord());
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || saving) return; setSaving(true); setError('');
    try { const saved = await write({ ...draft, code: draft.code || recordCode(draft.name, draft.id) }); upsert(saved); if (!catalogId && saved.catalogId) setCatalogId(saved.catalogId); setMessage(`${saved.name} saved.`); setSelected(null); setDraft(null); } catch (e) { report(e); } finally { setSaving(false); }
  };
  const archive = async () => {
    if (!selected || saving) return; setSaving(true); setError('');
    try { const saved = await requestCatalog(data.workspaceId, `/records/${selected.id}`, 'PATCH', { version: selected.version, archived: !selected.archived }); upsert(saved); setSelected(saved); setMessage(`${saved.name} ${saved.archived ? 'archived' : 'restored'}.`); } catch (e) { report(e); } finally { setSaving(false); }
  };
  const [importCatalogId] = useState(() => crypto.randomUUID());
  const openImport = async () => {
    if (saving || sheetDirty) return;
    if (catalogId) { setImportOpen(true); return; }
    setSaving(true); setError('');
    try {
      const created = await requestCatalog(data.workspaceId, '/collections', 'POST', { id: importCatalogId, name: 'Workspace catalog', starter: false });
      upsert(created); setCatalogId(created.id); setLoadedCatalogs(previous => new Set(previous).add(created.id)); setImportOpen(true);
    } catch (error) { report(error); } finally { setSaving(false); }
  };
  const exportRecords = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 2, catalog: activeCatalog, items }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'master-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const title = variant ? `${item ? catalogRecordName(item) : 'Item'} · ${variant.configuration?.specificationTier || variant.name}` : item ? catalogRecordName(item) : room ? room.name : activeCatalog?.name ?? 'Catalog';
  const rootTabs: CatalogView[] = ['room', 'work', 'products', 'brand', 'unit'];
  const tabs: CatalogView[] = item ? ['variant', 'components'] : rootTabs;
  const tableMode = view !== 'room' && !editingTable;
  const addButton = !data.error && data.canManage && <Button variant="primary" size="compact" isDisabled={saving || sheetDirty || archived || !catalogReady} onPress={() => void add()}><Plus size={15} />Add {singular[view]}</Button>;
  const editTableButton = data.canManage && catalogReady && !archived && view !== 'components' && view !== 'room' && <Button size="compact" isDisabled={saving} onPress={() => { const action = () => { setEditingTable(!editingTable); setSheetDirty(false); }; if (sheetDirty) setDiscard(() => action); else action(); }}><Table2 size={14} />{editingTable ? 'Done editing' : 'Edit table'}</Button>;
  const archiveCheckbox = <Checkbox isSelected={archived} isDisabled={sheetDirty} onChange={value => { setArchived(value); setPage(1); }}>Archived</Checkbox>;
  return <DesignSystemProvider {...inherited} currency={data.currency ?? inherited.currency} portalContainer={portal}>
    <div ref={setPortal} className={`${styles.page} ${workspaceColors.theme}`} aria-label="Master Data workspace">
      <nav className={styles.breadcrumbs} aria-label="Master Data navigation"><a href="/workspace/catalogs">Catalogs</a>{activeCatalog && <><ChevronRight size={12} />{room || item ? <button onClick={() => changeView('room')}>{activeCatalog.name}</button> : <span aria-current="page">{activeCatalog.name}</span>}</>}{room && <><ChevronRight size={12} />{item ? <button onClick={() => changeView('work', room.id)}>{room.name}</button> : <span aria-current="page">{room.name}</span>}</>}{item && <><ChevronRight size={12} />{variant ? <button onClick={() => changeView('variant', roomId, item.id)}>{catalogRecordName(item)}</button> : <span aria-current="page">{catalogRecordName(item)}</span>}</>}{variant && <><ChevronRight size={12} /><span aria-current="page">{String(variant.configuration?.specificationTier || variant.name)}</span></>}</nav>
      <header className={styles.header}><div><h1>{title}</h1></div><div className={styles.actions}>
        {catalogs.length > 1 && <div className={styles.catalogSelector}><SelectField label="Catalog" selectedKey={catalogId} isDisabled={saving || Boolean(draft)} onSelectionChange={key => { if (!key || String(key) === catalogId) return; const action = () => { const targetView = !room && !item && view === 'products' ? '&view=materials' : !room && !item && view === 'work' ? '&view=items' : ''; router.push(`/workspace/catalogs?catalogId=${encodeURIComponent(String(key))}${targetView}`); }; if (sheetDirty) setDiscard(() => action); else action(); }} items={catalogs.map(record => ({ id: record.id, label: record.name }))} /></div>}
        <a className="wd-button" data-variant="secondary" data-size="compact" href="/templates/catalog-sample.xlsx" download><Download size={14} />Sample Excel</a>
        {data.canManage && <Button size="compact" isDisabled={sheetDirty || !catalogReady || saving} onPress={() => void openImport()}><Upload size={14} />Import</Button>}
        {!tableMode && addButton}
        <IconMenuButton ariaLabel="Master Data actions" items={[
          { id: 'refresh', label: 'Refresh', isDisabled: saving || sheetDirty }, { id: 'export', label: 'Export master data', isDisabled: !activeCatalog },
          ...(data.canManage ? [{ id: 'import', label: 'Import records', isDisabled: saving || sheetDirty || !catalogReady }, ...(item || room ? [{ id: 'edit', label: item ? 'Edit item' : 'Edit room', isDisabled: sheetDirty || !catalogReady }] : [])] : []),
          { id: 'brand', label: 'Brands', isDisabled: !activeCatalog }, { id: 'unit', label: 'Units', isDisabled: !activeCatalog },
        ]} onAction={key => { if (key === 'refresh') void refresh(); if (key === 'export') exportRecords(); if (key === 'brand' || key === 'unit') changeView(key); if (key === 'import') void openImport(); if (key === 'edit') edit((item || room || activeCatalog)!); }} />
      </div></header>
      {message && <p className={styles.success} role="status">{message}</p>}
      {(data.error || error) && !draft && !selected && <p className={styles.error} role="alert">{data.error || error}</p>}
      {!data.error && <>
        {!catalogReady && <p role="status" className={styles.context}>{loading ? 'Loading catalog…' : <><span>Catalog could not be loaded. </span><Button size="compact" onPress={() => { setError(''); setFailedCatalog(''); setLoadRetry(n => n + 1); }}>Retry</Button></>}</p>}
        {!room || item ? <div className={styles.tabs} role="group" aria-label={item ? 'Item sections' : 'Master Data sections'}>{tabs.map(tab => <button key={tab} aria-pressed={view === tab} id={`catalog-tab-${tab}`} onClick={() => changeView(tab, item ? roomId : '', item?.id ?? '')}>{viewLabels[tab]}</button>)}</div> : null}
        {variant && <dl className={styles.summary}>{['board_choice', 'laminate_choice', 'hardware_choice', 'accessory_choice'].map(key => { const relation = ({board_choice:'material',laminate_choice:'sku',hardware_choice:'hardware',accessory_choice:'consumable'})[key]; const value = graph.names(variant, relation ?? '') || catalogAttribute(variant, key); return value ? <div key={key}><dt>{({ board_choice: 'Board', laminate_choice: 'Finish', hardware_choice: 'Hardware', accessory_choice: 'Accessories' })[key]}</dt><dd>{value}</dd></div> : null; })}</dl>}
        {view === 'components' && <p className={styles.context}>{variant ? 'Shared item materials and additions for this variant.' : 'Shared materials used by every variant of this item.'} Each row shows a component, its required specification and the selected material product.</p>}
        {view === 'products' && catalogReady && !archived && <section className={styles.review} aria-label="Material review">
          <div className={styles.reviewHeader}><div><h2>{reviewRows.length ? `${reviewRows.length} materials need review` : 'Material review'}</h2><p>Check units, specifications and saved selling prices before quoting.</p></div>
            <Button size="compact" isDisabled={sheetDirty} aria-pressed={reviewOnly} onPress={() => { setReviewOnly(!reviewOnly); setPage(1); }}>{reviewOnly ? 'Show all materials' : 'Review missing details'}</Button>
          </div>
          {reviewOnly && (reviewRows.length ? <ul className={styles.reviewList}>{reviewRows.slice(0, 5).map(({ record, issues }) => <li key={record.id}><div><strong>{catalogRecordName(record)}</strong><small>{issues.map(issue => issue.label).join(' · ')}</small></div><div className={styles.actions}>
            {issues.some(issue => issue.kind === 'details') && <Button size="compact" isDisabled={sheetDirty} onPress={() => data.canManage ? edit(record) : open(record)}>{data.canManage ? 'Review details' : 'View details'}</Button>}
            {issues.some(issue => issue.kind === 'price') && <Button size="compact" isDisabled={sheetDirty} onPress={() => price(record)}>Review price</Button>}
          </div></li>)}</ul> : <p className={styles.reviewEmpty}>No missing details found by these checks. Quote-specific price dates, currency and approvals still apply.</p>)}
          {reviewOnly && reviewRows.length > 5 && <p className={styles.reviewEmpty}>Showing the first 5 to resolve. All matching materials are in the sheet below.</p>}
        </section>}
        <section id="catalog-panel" aria-label={viewLabels[view]}>
          {!tableMode && <div className={styles.toolbar}><SearchInput label={`Search ${viewLabels[view].toLowerCase()}`} placeholder="Search names, codes or specifications…" value={search} isDisabled={sheetDirty} onChange={value => { setSearch(value); setPage(1); }} /><div className={styles.actions}>
            {categories.length > 1 && <div className={styles.selector}><SelectField label="Category" aria-label="Category" isDisabled={sheetDirty} selectedKey={category} onSelectionChange={key => { setCategory(String(key)); setPage(1); }} items={[{ id: 'all', label: 'All categories' }, ...categories.map(name => ({ id: name, label: name }))]} /></div>}
            {archiveCheckbox}
            {editTableButton}
          </div></div>}
          {!catalogReady && !['room','work','variant','unit'].includes(view) ? <p role="status">{loading ? 'Loading catalog…' : 'Use Retry to load this section.'}</p> : editingTable ? <CatalogSheet key={`${catalogId}:${view}:${roomId}:${itemId}`} kind={view === 'products' ? 'all' : recordKind} items={viewItems} rows={visible} canManage={data.canManage && !saving && !archived && catalogReady} createRow={makeRecord} onDirtyChange={setSheetDirty} onSave={write} onSaved={upsert} onSaveComplete={(saved, failed) => setMessage(`${saved} saved.${failed ? ` ${failed} need attention.` : ''}`)} onOpen={open} /> : view === 'room' ? <CatalogRoomGrid rooms={visible} items={items} canManage={data.canManage && !saving && catalogReady} filtered={Boolean(search.trim()) || category !== 'all' || archived} onOpen={open} onEdit={edit} onDetails={record => { if(catalogReady) { setSelected(record); setDraft(null); setError(''); } }}/> : <CatalogHierarchyTable key={`${catalogId}:${view}:${roomId}:${itemId}:${variantId}:${archived}`} view={view} items={viewItems} rows={filtered} workspaceId={data.workspaceId} searchValue={search} onSearchChange={value => { setSearch(value); setPage(1); }} totalRowCount={sourceRows.length} toolbarActions={<>{editTableButton}{addButton}</>} footerActions={archiveCheckbox} canManage={data.canManage && !saving && !archived && catalogReady} canViewCosts={data.canViewCosts === true} componentCounts={data.componentCounts} pricesLoading={!catalogReady} onDetails={record => { if(catalogReady) { setSelected(record); setDraft(null); setError(''); } }} onRelated={related} onOpen={open} onEdit={edit} onPrice={price} />}
          {!tableMode && <div className={styles.pager}><span>{filtered.length} {viewLabels[view].toLowerCase()} · Page {currentPage} of {pages}</span><div className={styles.actions}><Button size="compact" isDisabled={sheetDirty || currentPage === 1} onPress={() => setPage(currentPage - 1)}>Previous</Button><Button size="compact" isDisabled={sheetDirty || currentPage === pages} onPress={() => setPage(currentPage + 1)}>Next</Button></div></div>}
        </section>
      </>}
      <InspectorSheet isOpen={Boolean(selected || draft)} onOpenChange={opened => { if (!opened) close(); }} isDirty={dirty && !saving} size="md" title={draft ? `${draft.version ? 'Edit' : 'New'} ${catalogRecordName(draft) || singular[view]}` : selected ? catalogRecordName(selected) : 'Details'} footer={draft ? <div className={styles.actions}><Button isDisabled={saving} onPress={() => dirty ? setDiscard(() => close) : close()}>Cancel</Button><Button variant="primary" type="submit" form="catalog-editor" isLoading={saving}>Save</Button></div> : selected && data.canManage ? <div className={styles.actions}><Button isDisabled={saving} onPress={() => void archive()}>{selected.archived ? 'Restore' : 'Archive'}</Button><Button variant="primary" isDisabled={saving || selected.archived} onPress={() => edit(selected)}>Edit</Button></div> : undefined}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {draft ? (['work','variant',...materialKinds].includes(draft.kind) || draft.kind === 'construction' && draft.configuration?.recordRole === 'component') ? <CatalogEntryEditor key={draft.id} draft={draft} setDraft={setDraft} items={viewItems} onSubmit={save} saving={saving} onRelated={related} onPrice={() => price(selected || draft)} /> : <CatalogEditor draft={draft} setDraft={setDraft} items={viewItems} onSubmit={save} saving={saving} fixedKind /> : selected && <CatalogRecordDetails record={selected} items={viewItems} canManage={data.canManage && !selected.archived} busy={saving} onOpen={related} onEdit={edit} onPrice={key => price(selected, key)} onAddComponent={parent => void addComponent(parent)} />}
      </InspectorSheet>
      {priceTarget && <CatalogPriceDialog key={priceTarget.id} target={priceTarget} initialSourceKey={priceSourceKey} items={viewItems} canManage={data.canManage && !priceTarget.archived && priceableKinds.includes(priceTarget.kind)} canViewCosts={data.canViewCosts === true} onClose={() => { setPriceTarget(null); setPriceSourceKey(undefined); }} onSave={write} onSaved={upsert} onArchive={record => requestCatalog(data.workspaceId, `/records/${record.id}`, 'PATCH', { version: record.version, archived: true })} />}
      {importOpen && <CatalogImportDialog catalogId={catalogId} items={items} initialKind={recordKind} groupId="" onClose={() => setImportOpen(false)} onValidate={plan => requestCatalog(data.workspaceId, '/import', 'POST', { catalogId, dryRun: true, records: plan.records.map(savePayload), references: plan.references })} onImport={plan => requestCatalog(data.workspaceId, '/import', 'POST', { catalogId, records: plan.records.map(savePayload), references: plan.references })} onImported={result => { setData(d => ({ ...d, items: [...d.items.filter(r => !result.items.some(saved => saved.id === r.id)), ...result.items] })); setMessage(`${result.created} records imported.`); }} />}
    </div>
    <ConfirmationDialog isOpen={Boolean(discard)} onOpenChange={opened => { if (!opened) setDiscard(null); }} title="Discard unsaved changes?" body="Your saved records remain available." confirmLabel="Discard changes" onConfirm={() => { const action = discard; setDiscard(null); action?.(); }} />
  </DesignSystemProvider>;
}
