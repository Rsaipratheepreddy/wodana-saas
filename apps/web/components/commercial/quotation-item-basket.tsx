'use client';
import { useRef, useState } from 'react';
import { ImagePlus, Plus, Search, ShoppingBasket, Trash2 } from 'lucide-react';
import { ControlledModalDialog } from '@/design-system';
import type { Quote, QuoteLine } from '@/lib/commercial/types';
import { newLine } from '@/lib/commercial/client';
import { catalogItem, roomNames } from '@/lib/commercial/room-builder';
import { applyCatalogMedia, quotationPhoto } from '@/lib/commercial/quotation-table';
import { useCatalogOptions } from './catalog-options-cache';
import type { CommercialCatalogChoice } from './catalog-picker';
import s from './quotation-item-basket.module.css';
type Entry = {
    key: string;
    line: QuoteLine;
    choice?: CommercialCatalogChoice;
};
export function QuotationItemBasket({ quote, workspaceId, caseId, initialRoom, canCreate, onAdd, onClose }: {
    quote: Quote;
    workspaceId: string;
    caseId: string;
    initialRoom: string;
    canCreate: boolean;
    onAdd: (lines: QuoteLine[]) => void;
    onClose: () => void;
}) {
    const [room, setRoom] = useState(initialRoom || 'General'), [query, setQuery] = useState(''), [entries, setEntries] = useState<Entry[]>([]), [creating, setCreating] = useState(false);
    const [custom, setCustom] = useState(() => ({...newLine(initialRoom || 'General'),title:''})), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const { items, loading, error: catalogError, refresh } = useCatalogOptions(workspaceId, caseId, 'work', query);
    const photo = useRef<HTMLInputElement>(null), target = useRef<string | null>(null);
    const existing = new Set(entries.map(entry => entry.key));
    const capacity = 300 - quote.lines.length;
    const available = items.filter(item => !existing.has(item.id));
    function toggle(choice: CommercialCatalogChoice) { setError(''); if (existing.has(choice.id)) {
        setEntries(current => current.filter(entry => entry.key !== choice.id));
        return;
    } if (entries.length >= capacity) {
        setError('This quotation supports up to 300 items.');
        return;
    } setEntries(current => [...current, { key: choice.id, line: catalogItem(room, choice), choice }]); }
    async function upload(file?: File) { if (!file)
        return; setBusy(true); setError(''); try {
        const src = await quotationPhoto(file);
        if (target.current === 'custom')
            setCustom(current => ({ ...current, photo: src }));
        else
            setEntries(current => current.map(entry => entry.key === target.current ? { ...entry, line: { ...entry.line, photo: src } } : entry));
    }
    catch (error) {
        setError((error as Error).message);
    }
    finally {
        setBusy(false);
        if (photo.current)
            photo.current.value = '';
    } }
    async function add() { if (busy || !entries.length || entries.length > capacity)
        return; setBusy(true); setError(''); try {
        const lines: QuoteLine[] = [];
        for (let index = 0; index < entries.length; index += 6) {
            lines.push(...await Promise.all(entries.slice(index, index + 6).map(entry => applyCatalogMedia(workspaceId, { ...entry.line, room }, entry.choice))));
        }
        onAdd(lines);
        onClose();
    }
    catch (error) {
        setError((error as Error).message);
    }
    finally {
        setBusy(false);
    } }
    const imageUrl = (item: CommercialCatalogChoice) => { const asset = item.primaryAsset; return asset ? `/api/workspace/catalog/records/${asset.recordId}/assets/${asset.id}/content?${new URLSearchParams({ workspaceId, preview: asset.hasPreview ? '1' : '0' })}` : undefined; };
    return <ControlledModalDialog title="Add scope items" isOpen onOpenChange={open => { if (!open && !busy)
        onClose(); }} size="xl" footer={<div className={s.footer}><span><ShoppingBasket size={15}/>{entries.length} selected</span><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={s.primary} disabled={busy || !entries.length || entries.length > capacity} onClick={() => void add()}>{busy ? 'Preparing items…' : `Add ${entries.length || ''} item${entries.length === 1 ? '' : 's'}`}</button></div>}>
  <div className={s.basket}><div className={s.toolbar}><label className={s.search}><Search size={16}/><input aria-label="Search basket catalogue" value={query} placeholder="Search catalogue items…" disabled={busy} onChange={event => setQuery(event.target.value)}/></label><label>Room / area<select value={room} disabled={busy} onChange={event => setRoom(event.target.value)}>{[...new Set([...roomNames(quote), initialRoom || 'General'])].map(name => <option key={name}>{name}</option>)}</select></label><button type="button" disabled={busy || !canCreate} title={!canCreate ? 'Custom items require price override permission' : undefined} onClick={() => { setCreating(!creating); setError(''); }}><Plus size={15}/>Create item</button></div>
  <input ref={photo} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload basket item image" onChange={event => void upload(event.target.files?.[0])}/>
  {creating && <fieldset className={s.create} disabled={busy}><legend>Create a quotation item</legend><p>Added to this quotation only. Catalogue records are not changed.</p><div className={s.createFields}><label>Item name<input maxLength={240} value={custom.title} onChange={event => setCustom({ ...custom, title: event.target.value })}/></label><label>Unit<input maxLength={20} value={custom.unit} onChange={event => setCustom({ ...custom, unit: event.target.value })}/></label><label>Quantity<input type="number" min="0.001" max="1000000" step="any" value={custom.quantity} onChange={event => setCustom({ ...custom, quantity: Number(event.target.value) })}/></label><label>Rate · {quote.currency}<input type="number" min="0" max="1000000000" step="0.01" value={custom.rate} onChange={event => setCustom({ ...custom, rate: Number(event.target.value) })}/></label><label className={s.wide}>Description & materials<textarea rows={2} maxLength={3000} value={custom.specification} onChange={event => setCustom({ ...custom, specification: event.target.value })}/></label><label className={s.wide}>Reason for custom item<input maxLength={500} placeholder="For example: bespoke item requested by the client" value={custom.manualReason ?? ''} onChange={event => setCustom({ ...custom, manualReason: event.target.value })}/></label></div><div className={s.createActions}><button type="button" onClick={() => { target.current = 'custom'; photo.current?.click(); }}>{custom.photo ? <img src={custom.photo} alt="Custom item"/> : <ImagePlus size={18}/>} {custom.photo ? 'Replace image' : 'Upload image'}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button><button type="button" className={s.primary} disabled={!canCreate || !custom.title.trim() || !custom.unit.trim() || !custom.manualReason?.trim() || !Number.isFinite(custom.quantity) || custom.quantity <= 0 || !Number.isFinite(custom.rate) || custom.rate < 0 || entries.length >= capacity} onClick={() => { const id = crypto.randomUUID(); setEntries(current => [...current, { key: id, line: { ...custom, id, room } }]); setCustom({ ...newLine(room), title: '' }); setCreating(false); }}>Add to basket</button></div></fieldset>}
  {error && <p role="alert" className={s.error}>{error}</p>}
  <div className={s.columns}><section><div className={s.listHeading}><strong>Catalogue</strong><button type="button" disabled={busy || loading || !available.length || entries.length + available.length > capacity} onClick={() => setEntries(current => [...current, ...available.map(choice => ({ key: choice.id, line: catalogItem(room, choice), choice }))])}>Select all shown ({items.length})</button></div>{catalogError ? <p role="alert">{catalogError} <button type="button" onClick={refresh}>Retry</button></p> : loading ? <p role="status">Loading items…</p> : !items.length ? <div className={s.empty}>No matching items.{canCreate && <button type="button" onClick={() => setCreating(true)}>Create an item here</button>}</div> : <div className={s.results}>{items.map(item => <label className={s.option} key={item.id}><input type="checkbox" disabled={busy || (!existing.has(item.id) && entries.length >= capacity)} checked={existing.has(item.id)} onChange={() => toggle(item)}/>{imageUrl(item) ? <img loading="lazy" src={imageUrl(item)} alt=""/> : <span className={s.placeholder}><ImagePlus size={19}/></span>}<span><strong>{item.name}</strong><small>{item.description || item.catalogName || item.code}</small></span></label>)}</div>}{items.length === 100 && <p className={s.hint}>Showing the first 100 results. Search to find more items.</p>}</section>
  <aside><div className={s.listHeading}><strong>Basket · {entries.length}</strong><button type="button" disabled={busy || !entries.length} onClick={() => setEntries([])}>Clear</button></div>{!entries.length ? <p className={s.empty}>Select items to add them together.</p> : entries.map(entry => <div className={s.selected} key={entry.key}><button type="button" className={s.photo} disabled={busy} aria-label={`Upload image for ${entry.line.title}`} onClick={() => { target.current = entry.key; photo.current?.click(); }}>{entry.line.photo || entry.choice && imageUrl(entry.choice) ? <img src={entry.line.photo || imageUrl(entry.choice!)} alt=""/> : <ImagePlus size={20}/>}</button><div><strong>{entry.line.title}</strong><label>Qty<input type="number" min="0.001" max="1000000" step="any" disabled={busy} value={entry.line.quantity} onChange={event => { const quantity = Number(event.target.value); if (quantity > 0 && quantity <= 1000000)
        setEntries(current => current.map(item => item.key === entry.key ? { ...item, line: { ...item.line, quantity } } : item)); }}/></label></div><button type="button" disabled={busy} aria-label={`Remove ${entry.line.title} from basket`} onClick={() => setEntries(current => current.filter(item => item.key !== entry.key))}><Trash2 size={14}/></button></div>)}</aside></div>
  </div>
 </ControlledModalDialog>;
}
