'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { useRef, useState } from 'react';
import { ImagePlus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { Button, Checkbox, ControlledModalDialog, EmptyState, IconButton, InlineNotice, MoneyField, NumericInput, SearchInput, SelectField, Skeleton, TextAreaField, TextInput, TooltipBubble } from '@/design-system';
import { translateKnown } from '@/lib/i18n/keys';
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
  const t = useT();
    const fallbackRoom = initialRoom || t('General');
    const [room, setRoom] = useState(fallbackRoom), [query, setQuery] = useState(''), [entries, setEntries] = useState<Entry[]>([]), [creating, setCreating] = useState(false);
    const [custom, setCustom] = useState(() => ({...newLine(fallbackRoom),title:''})), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const { items, loading, error: catalogError, refresh } = useCatalogOptions(workspaceId, caseId, 'work', query);
    const photo = useRef<HTMLInputElement>(null), target = useRef<string | null>(null);
    const existing = new Set(entries.map(entry => entry.key));
    const capacity = 300 - quote.lines.length;
    const available = items.filter(item => !existing.has(item.id));
    function toggle(choice: CommercialCatalogChoice) { setError(''); if (existing.has(choice.id)) {
        setEntries(current => current.filter(entry => entry.key !== choice.id));
        return;
    } if (entries.length >= capacity) {
        setError(t('This quotation supports up to 300 items.'));
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
    return <ControlledModalDialog title={t("Add scope items")} isOpen onOpenChange={open => { if (!open && !busy)
        onClose(); }} size="xl" footer={<div className={s.footer}><span><ShoppingBasket size={15}/>{t("{count} selected", { count: entries.length })}</span><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isDisabled={busy || !entries.length || entries.length > capacity} onPress={() => void add()}>{busy ? t('Preparing items…') : entries.length === 1 ? t('Add {count} item', { count: 1 }) : entries.length ? t('Add {count} items', { count: entries.length }) : t('Add items')}</Button></div>}>
  <div className={s.basket}><div className={s.toolbar}><SearchInput label={t("Search basket catalogue")} placeholder={t("Search catalogue items…")} value={query} isDisabled={busy} onChange={setQuery}/><SelectField label={t("Room / area")} items={[...new Set([...roomNames(quote), fallbackRoom])].map(name => ({ id: name, label: name }))} selectedKey={room} isDisabled={busy} onSelectionChange={key => key !== null && setRoom(String(key))}/>{canCreate ? <Button size="compact" isDisabled={busy || !canCreate} onPress={() => { setCreating(!creating); setError(''); }}><Plus aria-hidden="true" size={14}/>{t("Create item")}</Button> : <TooltipBubble content={t('Custom items require price override permission')}><Button size="compact" isDisabled={busy || !canCreate} onPress={() => { setCreating(!creating); setError(''); }}><Plus aria-hidden="true" size={14}/>{t("Create item")}</Button></TooltipBubble>}</div>
  <input ref={photo} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Upload basket item image")} onChange={event => void upload(event.target.files?.[0])}/>
  {creating && <fieldset className={s.create} disabled={busy}><legend>{t("Create a quotation item")}</legend><p>{t("Added to this quotation only. Catalogue records are not changed.")}</p><div className={s.createFields}><TextInput label={t("Item name")} maxLength={240} value={custom.title} onChange={title => setCustom({ ...custom, title })}/><TextInput label={t("Unit")} maxLength={20} value={custom.unit} onChange={unit => setCustom({ ...custom, unit })}/><NumericInput label={t("Quantity")} minValue={0.001} maxValue={1000000} value={custom.quantity} onChange={quantity => setCustom({ ...custom, quantity })}/><MoneyField label={t("Rate · {currency}", { currency: quote.currency })} currency={quote.currency} min="0" max="1000000000" value={String(custom.rate)} onChange={rate => setCustom({ ...custom, rate: Number(rate) })}/><div className={s.wide}><TextAreaField label={t("Description & materials")} maxLength={3000} value={custom.specification} onChange={specification => setCustom({ ...custom, specification })}/></div><div className={s.wide}><TextInput label={t("Reason for custom item")} maxLength={500} placeholder={t("For example: bespoke item requested by the client")} value={custom.manualReason ?? ''} onChange={manualReason => setCustom({ ...custom, manualReason })}/></div></div><div className={s.createActions}><Button size="compact" onPress={() => { target.current = 'custom'; photo.current?.click(); }}>{custom.photo ? <img src={custom.photo} alt={t("Custom item")}/> : <ImagePlus aria-hidden="true" size={14}/>}{t(custom.photo ? 'Replace image' : 'Upload image')}</Button><Button size="compact" onPress={() => setCreating(false)}>{t("Cancel")}</Button><Button size="compact" variant="primary" isDisabled={!canCreate || !custom.title.trim() || !custom.unit.trim() || !custom.manualReason?.trim() || !Number.isFinite(custom.quantity) || custom.quantity <= 0 || !Number.isFinite(custom.rate) || custom.rate < 0 || entries.length >= capacity} onPress={() => { const id = crypto.randomUUID(); setEntries(current => [...current, { key: id, line: { ...custom, id, room } }]); setCustom({ ...newLine(room), title: '' }); setCreating(false); }}>{t("Add to basket")}</Button></div></fieldset>}
  {error && <InlineNotice tone="error" message={translateKnown(t, error)} />}
  <div className={s.columns}><section><div className={s.listHeading}><strong>{t("Catalogue")}</strong><Button size="compact" variant="quiet" isDisabled={busy || loading || !available.length || entries.length + available.length > capacity} onPress={() => setEntries(current => [...current, ...available.map(choice => ({ key: choice.id, line: catalogItem(room, choice), choice }))])}>{t("Select all shown ({count})", { count: items.length })}</Button></div>{catalogError ? <InlineNotice tone="error" message={translateKnown(t, catalogError)} action={<Button size="compact" variant="quiet" onPress={refresh}>{t("Retry")}</Button>} /> : loading ? <Skeleton shape="rows" lines={4} /> : !items.length ? <EmptyState illustration={null} title={t("No matching items.")} action={canCreate ? <Button size="compact" onPress={() => setCreating(true)}>{t("Create an item here")}</Button> : undefined} /> : <div className={s.results}>{items.map(item => <div className={s.option} key={item.id}><Checkbox isDisabled={busy || (!existing.has(item.id) && entries.length >= capacity)} isSelected={existing.has(item.id)} onChange={() => toggle(item)}>{imageUrl(item) ? <img loading="lazy" src={imageUrl(item)} alt=""/> : <span className={s.placeholder}><ImagePlus size={19}/></span>}<span><strong>{item.name}</strong><small>{item.description || item.catalogName || item.code}</small></span></Checkbox></div>)}</div>}{items.length === 100 && <p className={s.hint}>{t("Showing the first 100 results. Search to find more items.")}</p>}</section>
  <aside><div className={s.listHeading}><strong>{t("Basket · {count}", { count: entries.length })}</strong><Button size="compact" variant="quiet" isDisabled={busy || !entries.length} onPress={() => setEntries([])}>{t("Clear")}</Button></div>{!entries.length ? <p className={s.empty}>{t("Select items to add them together.")}</p> : entries.map(entry => <div className={s.selected} key={entry.key}><button type="button" className={s.photo} disabled={busy} aria-label={t("Upload image for {title}", { title: entry.line.title })} onClick={() => { target.current = entry.key; photo.current?.click(); }}>{entry.line.photo || entry.choice && imageUrl(entry.choice) ? <img src={entry.line.photo || imageUrl(entry.choice!)} alt=""/> : <ImagePlus size={20}/>}</button><div><strong>{entry.line.title}</strong><NumericInput label={t("Qty")} minValue={0.001} maxValue={1000000} isDisabled={busy} value={entry.line.quantity} onChange={quantity => { if (quantity > 0 && quantity <= 1000000)
        setEntries(current => current.map(item => item.key === entry.key ? { ...item, line: { ...item.line, quantity } } : item)); }}/></div><IconButton size="compact" isDisabled={busy} aria-label={t("Remove {title} from basket", { title: entry.line.title })} onPress={() => setEntries(current => current.filter(item => item.key !== entry.key))}><Trash2 aria-hidden="true" size={14}/></IconButton></div>)}</aside></div>
  </div>
 </ControlledModalDialog>;
}
