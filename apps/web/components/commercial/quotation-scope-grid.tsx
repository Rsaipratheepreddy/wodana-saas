'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { useRef, useState } from 'react';
import { Copy, ImagePlus, Plus, Sparkles, Trash2, Pencil } from 'lucide-react';
import { Button, Checkbox, ControlledModalDialog, IconButton, InlineNotice, NumericInput, SearchInput, SegmentedControl, SelectField, Switch, TextAreaField, TextInput, useConfirmationDialog, useDesignSystem } from '@/design-system';
import { tKey, translateKnown } from '@/lib/i18n/keys';
import type { Quote, QuoteLine, QuotationMaterialRow } from '@/lib/commercial/types';
import { money, quoteTotals, roundMoney } from '@/lib/commercial/client';
import { roomNames, selection, selectVariant } from '@/lib/commercial/room-builder';
import { quotationDescription } from '@/lib/commercial/presentation';
import { quotationMaterialRows, quotationPhoto, pricedLine, materialAmount } from '@/lib/commercial/quotation-table';
import { usesCatalogPricing, catalogPriceInput } from '@/lib/commercial/catalog-price';
import { customUnit } from '@/lib/commercial/materials';
import { addQuotationSuggestions, type RoomSuggestion } from '@/lib/commercial/quotation-assist';
import { CommercialCatalogPicker, type CommercialCatalogChoice } from './catalog-picker';
import { QuotationNumberInput } from './quotation-number-input';
import { QuotationCatalogPrice } from './quotation-catalog-price';
import { QuotationScopeAssistant } from './quotation-scope-assistant';
import { QuotationItemBasket } from './quotation-item-basket';
import s from './quotation-scope-grid.module.css';
const dimensionText = {
    length: { short: tKey('L'), field: tKey('length for {title}'), item: tKey('Item length'), label: tKey('Length') },
    height: { short: tKey('H'), field: tKey('height for {title}'), item: tKey('Item height'), label: tKey('Height') },
    depth: { short: tKey('D'), field: tKey('depth for {title}'), item: tKey('Item depth'), label: tKey('Depth') },
} as const;
type Props = {
    quote: Quote;
    onChange: (quote: Quote, checkpoint?: boolean) => void;
    readOnly: boolean;
    workspaceId: string;
    caseId: string;
    canOverridePrice: boolean;
};
export function QuotationScopeGrid({ quote, onChange, readOnly, workspaceId, caseId, canOverridePrice }: Props) {
  const t = useT();
    const { locale } = useDesignSystem();
    const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
    const [taxEntryEnabled, setTaxEntryEnabled] = useState(quote.taxRate > 0);
    const previousTaxRate = useRef(quote.taxRate);
    const taxEnabled = quote.taxRate > 0 || taxEntryEnabled;
    const [group, setGroup] = useState('room'), [search, setSearch] = useState(''), [ai, setAi] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const [roomDialog, setRoomDialog] = useState(false), [roomName, setRoomName] = useState(''), [originalRoom, setOriginalRoom] = useState<string | null>(null), [roomChoice, setRoomChoice] = useState<CommercialCatalogChoice | null>(null);
    const [itemDialog, setItemDialog] = useState(false), [targetRoom, setTargetRoom] = useState('');
    const [columnsOpen, setColumnsOpen] = useState(false), [columnName, setColumnName] = useState('');
    const [detail, setDetail] = useState<QuoteLine | null>(null), [materialPicker, setMaterialPicker] = useState(false);
    const photoInput = useRef<HTMLInputElement>(null), photoTarget = useRef<string | null>(null), latest = useRef(quote);
    latest.current = quote;
    const rooms = roomNames(quote), totals = quoteTotals(quote), locked = readOnly || busy;
    const canAdd = !locked && quote.direction !== 'deduction';
    const filtered = quote.lines.filter(line => [line.title, line.room, quotationDescription(line)].join(' ').toLowerCase().includes(search.toLowerCase()));
    const groups = group === 'room' ? rooms.filter(room => !search || filtered.some(line => line.room === room)).map(room => ({ name: room, lines: filtered.filter(line => line.room === room) })) : [{ name: '', lines: filtered }];
    const emit = (next: Quote, checkpoint = false) => { if (!readOnly) {
        onChange(next, checkpoint);
        latest.current = next;
    } };
    function patch(id: string, changes: Partial<QuoteLine>) { const current = latest.current; emit({ ...current, lines: current.lines.map(line => line.id === id ? pricedLine({ ...line, ...changes }) : line) }); }
    function openAdd(room?: string) { setTargetRoom(room || rooms[0] || t('General')); setError(''); setItemDialog(true); }
    function openRoom(room?: string) { setOriginalRoom(room ?? null); setRoomName(room ?? ''); setRoomChoice(quote.rooms?.find(item => item.name === room)?.catalog?.snapshot ?? null); setError(''); setRoomDialog(true); }
    function saveRoom() { const name = roomName.trim(); if (!name)
        return; const current = latest.current; if (roomNames(current).some(room => room !== originalRoom && room.toLowerCase() === name.toLowerCase())) {
        setError(t('This room already exists.'));
        return;
    } const entry = { id: current.rooms?.find(room => room.name === originalRoom)?.id ?? crypto.randomUUID(), name, ...(roomChoice ? { catalog: selection('room', roomChoice) } : {}) }; emit({ ...current, rooms: originalRoom ? (current.rooms ?? roomNames(current).map(name => ({ id: crypto.randomUUID(), name }))).map(room => room.name === originalRoom ? entry : room) : [...(current.rooms ?? roomNames(current).map(name => ({ id: crypto.randomUUID(), name }))), entry], lines: current.lines.map(line => line.room === originalRoom ? { ...line, room: name } : line) }, true); setRoomDialog(false); }
    async function uploadPhoto(file?: File) { const id = photoTarget.current; if (!file || !id || readOnly)
        return; setBusy(true); setError(''); try {
        const photo = await quotationPhoto(file);
        patch(id, { photo });
    }
    catch (error) {
        setError((error as Error).message);
    }
    finally {
        setBusy(false);
        if (photoInput.current)
            photoInput.current.value = '';
    } }
    function removeLine(line: QuoteLine) { requestConfirmation({ title: t('Remove {title}?', { title: line.title }), body: t('You can undo this change.'), confirmLabel: t('Remove item'), onConfirm: () => { const current = latest.current; emit({ ...current, ...(current.presentation?.scopeColumns ? { presentation: { ...current.presentation, scopeColumns: { ...current.presentation.scopeColumns, custom: current.presentation.scopeColumns.custom.map(column => ({ ...column, values: Object.fromEntries(Object.entries(column.values).filter(([id]) => id !== line.id)) })) } } } : {}), lines: current.lines.filter(item => item.id !== line.id) }, true); } }); }
    function duplicateLine(line: QuoteLine) { if (quote.lines.length >= 300)
        return; const current = latest.current, index = current.lines.findIndex(item => item.id === line.id); const duplicate = { ...structuredClone(line), id: crypto.randomUUID() }; emit({ ...current, ...(current.presentation?.scopeColumns ? { presentation: { ...current.presentation, scopeColumns: { ...current.presentation.scopeColumns, custom: current.presentation.scopeColumns.custom.map(column => ({ ...column, values: { ...column.values, ...(column.values[line.id] !== undefined ? { [duplicate.id]: column.values[line.id] } : {}) } })) } } } : {}), lines: [...current.lines.slice(0, index + 1), duplicate, ...current.lines.slice(index + 1)] }, true); }
    function priceApply(basis: QuoteLine, currency: string, taxRate: number, changes: Partial<QuoteLine>) { const current = latest.current, line = current.lines.find(line => line.id === basis.id); if (!line || current.currency !== currency || current.taxRate !== taxRate || JSON.stringify(catalogPriceInput(line, currency, taxRate)) !== JSON.stringify(catalogPriceInput(basis, currency, taxRate)))
        return false; patch(line.id, changes); return true; }
    function applySuggestions(suggestions: RoomSuggestion[]) { const current = latest.current, next = addQuotationSuggestions(current, suggestions); const count = next.lines.length - current.lines.length; emit(next, true); setNotice(count ? t('{count} suggested items added. Check dimensions, quantities and rates.', { count }) : t('These items are already in the quotation.')); }
    const builtins = [{ id: 'index', name: '#', width: 45 }, { id: 'image', name: t('Image'), width: 110 }, { id: 'item', name: t('Item'), width: 180 }, { id: 'description', name: t('Description & materials'), width: 240 }, { id: 'dimensions', name: t('Dimensions'), width: 170 }, { id: 'quantity', name: t('Qty'), width: 65 }, { id: 'unit', name: t('Unit'), width: 64 }, { id: 'rate', name: t('Rate · {currency}', { currency: quote.currency }), width: 90 }, { id: 'pricing', name: t('Pricing'), width: 145 }, { id: 'amount', name: t('Amount · {currency}', { currency: quote.currency }), width: 100 }, { id: 'actions', name: t('Actions'), width: 70 }];
    const configurableBuiltins = builtins.filter(column => column.id !== 'pricing');
    const config = quote.presentation?.scopeColumns ?? { hidden: ['index'], custom: [] };
    const visible = builtins.filter(column => column.id === 'pricing' || !config.hidden.includes(column.id));
    const count = visible.length + config.custom.length;
    function configure(next: typeof config) { if (next.hidden.length === configurableBuiltins.length && !next.custom.length)
        next = { ...next, hidden: next.hidden.filter(id => id !== 'item') }; const current = latest.current; if (current.presentation)
        emit({ ...current, presentation: { ...current.presentation, scopeColumns: next } }, true); }
    function customCell(columnId: string, lineId: string, value: string) { const current = latest.current; const existing = current.presentation?.scopeColumns ?? config; configure({ ...existing, custom: existing.custom.map(column => column.id === columnId ? { ...column, values: { ...column.values, [lineId]: value } } : column) }); }
    const rows = detail ? quotationMaterialRows(detail) : [];
    function materialRows(next: QuotationMaterialRow[]) { if (detail)
        setDetail(pricedLine({ ...detail, materialRows: next })); }
    function materialPatch(id: string, change: Partial<QuotationMaterialRow>) { materialRows(rows.map(row => row.id === id ? { ...row, ...change } : row)); }
    const rate = (line: QuoteLine) => usesCatalogPricing(line) || locked || line.pricingMode === 'materials' ? <span>{line.rate.toFixed(2)}</span> : <QuotationNumberInput label={t('Rate for {title}', { title: line.title })} value={line.rate} money onChange={rate => patch(line.id, { rate })}/>;
    return <div className={s.workspace} data-assistant={ai || undefined}>
 <section className={s.main} aria-label={t("Quotation scope and pricing")}>
  <div className={s.toolbar}>
   <div><SearchInput label={t("Search quotation items")} placeholder={t("Search items…")} value={search} onChange={setSearch}/><SegmentedControl label={t("Item grouping")} value={group} onChange={setGroup} options={[{ id: 'room', label: t("By room") }, { id: 'item', label: t("All items") }]}/></div>
   <div><Button size="compact" isDisabled={locked} onPress={() => setColumnsOpen(true)}>{t("Columns")}</Button>{!readOnly && <><Button size="compact" isDisabled={!canAdd || rooms.length >= 100} onPress={() => openRoom()}><Plus size={15}/>{t("Room")}</Button><Button size="compact" variant="primary" isDisabled={!canAdd || quote.lines.length >= 300} onPress={() => openAdd()}><Plus size={15}/>{t("Add item")}</Button><Button size="compact" aria-pressed={ai} isDisabled={!canAdd} onPress={() => setAi(!ai)}><Sparkles size={15}/>{t("AI assist")}</Button></>}</div>
  </div>
  {error && <InlineNotice tone="error" message={translateKnown(t, error)} />}{notice && <InlineNotice tone="success" message={notice} />}
  <input ref={photoInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Upload item photo")} onChange={event => void uploadPhoto(event.target.files?.[0])}/>
  <div className={s.tableScroll} tabIndex={0} aria-label={t("Quotation items table")}>
   <table style={{ minWidth: visible.reduce((sum, column) => sum + column.width, 0) + config.custom.length * 160 }} className={s.table}>
    <colgroup>{visible.map(column => <col key={column.id} style={{ width: column.width }}/>)}{config.custom.map(column => <col key={column.id} style={{ width: 160 }}/>)}</colgroup>
    <thead><tr>{visible.map(column => <th key={column.id} scope="col">{column.name}</th>)}{config.custom.map(column => <th key={column.id} scope="col">{column.name}</th>)}</tr></thead>
    {groups.map(({ name, lines }) => <tbody key={name || 'all'}>
     {name && <tr className={s.roomRow}><th colSpan={count} scope="rowgroup"><div><strong>{name}</strong><small>{t("{count} items", { count: lines.length })}</small><span className={s.spacer}/><span>{money(lines.reduce((sum, line) => sum + (line.optional ? 0 : roundMoney(line.quantity * line.rate)), 0), quote.currency, locale)}</span>{!readOnly && <><Button size="compact" isDisabled={!canAdd} aria-label={t("Add item to {room}", { room: name })} onPress={() => openAdd(name)}><Plus size={14}/>{t("Add item")}</Button><IconButton size="compact" isDisabled={locked} aria-label={t("Edit {title}", { title: name })} onPress={() => openRoom(name)}><Pencil aria-hidden="true" size={13}/></IconButton></>}</div></th></tr>}
     {lines.map(line => <tr key={line.id} className={s.itemRow}>
      {!config.hidden.includes('index') && <td className={s.index}>{quote.lines.indexOf(line) + 1}</td>}
      {!config.hidden.includes('image') && <td><button type="button" className={s.photo} disabled={locked} aria-label={t(line.photo ? 'Replace image for {title}' : 'Add image for {title}', { title: line.title })} onClick={() => { photoTarget.current = line.id; photoInput.current?.click(); }}>{line.photo ? <img src={line.photo} alt={line.title}/> : <ImagePlus size={22}/>}</button></td>}
      {!config.hidden.includes('item') && <td><input className={s.itemName} aria-label={t('Item name {id}', { id: quote.lines.indexOf(line) + 1 })} maxLength={240} value={line.title} disabled={locked} onChange={event => patch(line.id, { title: event.target.value })}/>{group === 'item' && <small>{line.room}</small>}{line.optional && <small>{t("Optional · excluded from total")}</small>}<Button size="compact" variant="quiet" onPress={() => { setDetail(structuredClone(line)); setMaterialPicker(false); }}>{t("Materials & options")}</Button></td>}
      {!config.hidden.includes('description') && <td><textarea aria-label={t('Description for {title}', { title: line.title })} rows={3} maxLength={32000} value={line.specification} disabled={locked} placeholder={t("Enter description…")} onChange={event => patch(line.id, { specification: event.target.value })}/>{(line.materialRows?.length || line.material || line.finish) ? <small>{quotationDescription({ ...line, specification: '' })}</small> : null}</td>}
      {!config.hidden.includes('dimensions') && <td><div className={s.inlineDimensions}>{(['length', 'height', 'depth'] as const).map(key => <label key={key}><span>{t(dimensionText[key].short)}</span><input type="number" min={0} max={1000000} step="any" disabled={locked} aria-label={t(dimensionText[key].field, { title: line.title })} placeholder="—" value={line.dimensions?.[key] ?? ''} onChange={event => { const value = event.target.value === '' ? undefined : Number(event.target.value); if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1000000))
                return; patch(line.id, { dimensions: { unit: 'mm', ...line.dimensions, [key]: value } }); }}/></label>)}<select aria-label={t('Dimension unit for {title}', { title: line.title })} value={line.dimensions?.unit ?? 'mm'} disabled={locked} onChange={event => patch(line.id, { dimensions: { ...line.dimensions, unit: event.target.value as NonNullable<QuoteLine['dimensions']>['unit'] } })}>{['mm', 'cm', 'm', 'in', 'ft'].map(unit => <option key={unit}>{unit}</option>)}</select></div></td>}
      {!config.hidden.includes('quantity') && <td>{locked ? line.quantity : <QuotationNumberInput label={t('Quantity for {title}', { title: line.title })} value={line.quantity} min={0.001} onChange={quantity => patch(line.id, { quantity })}/>}</td>}
      {!config.hidden.includes('unit') && <td><input aria-label={t('Unit for {title}', { title: line.title })} maxLength={20} value={line.unit} disabled={locked} list="quotation-common-units" onChange={event => patch(line.id, customUnit(line, event.target.value))}/></td>}
      {!config.hidden.includes('rate') && <td className={s.numeric}>{rate(line)}</td>}
      <td className={s.pricingCell}>{usesCatalogPricing(line) ? <QuotationCatalogPrice line={line} currency={quote.currency} taxRate={quote.taxRate} workspaceId={workspaceId} caseId={caseId} readOnly={locked} canOverride={canOverridePrice} showRate={false} onApply={priceApply}/> : <span className={s.manualPrice}>{t("Manual rate")}</span>}</td>
      {!config.hidden.includes('amount') && <td className={s.numeric}><strong>{roundMoney(line.quantity * line.rate).toFixed(2)}</strong></td>}
      {!config.hidden.includes('actions') && <td><div className={s.rowActions}><IconButton size="compact" isDisabled={locked || quote.lines.length >= 300 || quote.direction === 'deduction'} aria-label={t('Duplicate {title}', { title: line.title })} onPress={() => duplicateLine(line)}><Copy aria-hidden="true" size={14}/></IconButton><IconButton size="compact" isDisabled={locked} aria-label={t('Remove {title}', { title: line.title })} onPress={() => removeLine(line)}><Trash2 aria-hidden="true" size={14}/></IconButton></div></td>}
      {config.custom.map(column => <td key={column.id}><textarea rows={3} maxLength={2000} aria-label={t('{column} for {title}', { column: column.name, title: line.title })} disabled={locked} value={column.values[line.id] ?? ''} placeholder={t("Enter value…")} onChange={event => customCell(column.id, line.id, event.target.value)}/></td>)}
     </tr>)}
     {!lines.length && <tr><td colSpan={count} className={s.emptyRow}>{search ? t('No matching items.') : <>{t(name ? 'No items in this room.' : 'No items yet.')} {canAdd && <Button size="compact" onPress={() => openAdd(name)}><Plus size={14}/>{t("Add item")}</Button>}</>}</td></tr>}
    </tbody>)}
    {!groups.length && <tbody><tr><td colSpan={count} className={s.emptyRow}>{t(search ? 'No matching items.' : 'Start with a room or add your first item.')}</td></tr></tbody>}
   </table>
  </div>
  <datalist id="quotation-common-units">{['nos', 'pcs', 'set', 'm', 'm²', 'm³', 'ft', 'ft²', 'job', 'lot', 'hr'].map(unit => <option key={unit}>{unit}</option>)}</datalist>
  <footer className={s.totals}><span>{t("{count} items", { count: quote.lines.length })}</span><span className={s.spacer}/><span>{t("Subtotal")}{" "}<strong>{money(totals.subtotal, quote.currency, locale)}</strong></span><label>{t("Discount")}{" "}{locked ? <strong>{money(quote.discount, quote.currency, locale)}</strong> : <QuotationNumberInput label={t("Quotation discount")} value={quote.discount} money max={totals.subtotal} onChange={discount => emit({ ...latest.current, discount })}/>}</label><Switch aria-label={t("Enable tax")} isSelected={taxEnabled} isDisabled={locked} onChange={enabled => { setTaxEntryEnabled(enabled); if (!enabled)
        previousTaxRate.current = latest.current.taxRate; emit({ ...latest.current, taxRate: enabled ? previousTaxRate.current : 0 }, true); }}>{t("Tax")}</Switch>{taxEnabled && <label>{t("Rate %")}{locked ? <strong>{quote.taxRate}</strong> : <QuotationNumberInput label={t("Quotation tax percentage")} value={quote.taxRate} max={100} onChange={taxRate => { previousTaxRate.current = taxRate; emit({ ...latest.current, taxRate }); }}/>}</label>}<span>{t("Tax")}{" "}<strong>{money(totals.tax, quote.currency, locale)}</strong></span><span className={s.total}>{t("Total")}{" "}<strong>{money(totals.total, quote.currency, locale)}</strong></span></footer>
 </section>
 {ai && <QuotationScopeAssistant quote={quote} workspaceId={workspaceId} caseId={caseId} disabled={locked} onClose={() => setAi(false)} onApply={applySuggestions}/>}
 <ControlledModalDialog title={t("Columns")} isOpen={columnsOpen} onOpenChange={setColumnsOpen} size="md">
 <div className={s.form}><p>{t("Choose the columns to show. Hidden columns keep their values. Pricing status stays visible for review.")}</p><div className={s.columnChoices}>{configurableBuiltins.map(column => <Checkbox key={column.id} isSelected={!config.hidden.includes(column.id)} isDisabled={locked || (!config.hidden.includes(column.id) && count === 2 && !config.custom.length)} onChange={shown => configure({ ...config, hidden: shown ? config.hidden.filter(id => id !== column.id) : [...config.hidden, column.id] })}>{column.name}</Checkbox>)}</div>
 {config.custom.map(column => <div className={s.customColumn} key={column.id}><TextInput aria-label={t("Custom column name")} label={<span className="wd-visually-hidden">{t("Custom column name")}</span>} maxLength={80} value={column.name} onChange={name => { if (name.trim())
        configure({ ...config, custom: config.custom.map(item => item.id === column.id ? { ...item, name } : item) }); }}/><IconButton size="compact" aria-label={t('Delete column {name}', { name: column.name })} onPress={() => { requestConfirmation({ title: t('Delete {name}?', { name: column.name }), body: t('This removes the column and its values. You can undo this change.'), confirmLabel: t('Delete column'), onConfirm: () => configure({ ...config, custom: config.custom.filter(item => item.id !== column.id) }) }); }}><Trash2 aria-hidden="true" size={16}/></IconButton></div>)}
 <TextInput label={t("New custom column")} value={columnName} maxLength={80} placeholder={t("For example: Brand, Finish code, Lead time")} onChange={setColumnName}/><Button size="compact" isDisabled={locked || !columnName.trim() || config.custom.length >= 20} onPress={() => { configure({ ...config, custom: [...config.custom, { id: crypto.randomUUID(), name: columnName.trim(), values: {} }] }); setColumnName(''); }}>{t("Add column")}</Button></div>
 </ControlledModalDialog>
 <ControlledModalDialog title={t(originalRoom ? 'Edit room / area' : 'Add room / area')} isOpen={roomDialog} onOpenChange={setRoomDialog} size="md" footer={<div className={s.modalActions}><Button onPress={() => setRoomDialog(false)}>{t("Cancel")}</Button><Button variant="primary" isDisabled={locked || !roomName.trim()} onPress={saveRoom}>{t("Save room")}</Button></div>}>
  <div className={s.form}><CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="room" label={t("Room from catalogue (optional)")} value={roomChoice} disabled={locked} onChange={choice => { setRoomChoice(choice); if (choice)
        setRoomName(choice.name); }}/><TextInput label={t("Room name")} value={roomName} maxLength={120} onChange={setRoomName} isDisabled={locked}/>{error && <InlineNotice tone="error" message={translateKnown(t, error)} />}</div>
 </ControlledModalDialog>
 {itemDialog && <QuotationItemBasket quote={quote} workspaceId={workspaceId} caseId={caseId} initialRoom={targetRoom} canCreate={canOverridePrice} onClose={() => setItemDialog(false)} onAdd={lines => { if (!canAdd)
        return; const current = latest.current; if (current.lines.length + lines.length > 300)
        throw new Error(t('This quotation supports up to 300 items.')); const names = roomNames(current), newRooms = [...new Set(lines.map(line => line.room))].filter(name => !names.includes(name)); emit({ ...current, rooms: [...(current.rooms ?? names.map(name => ({ id: crypto.randomUUID(), name }))), ...newRooms.map(name => ({ id: crypto.randomUUID(), name }))], lines: [...current.lines, ...lines] }, true); setNotice(t('{count} items added. Review their dimensions and prices.', { count: lines.length })); }}/>}
 {detail && <ControlledModalDialog title={detail.title || t('Item details')} isOpen onOpenChange={open => { if (!open && !busy)
            setDetail(null); }} size="xl" footer={<div className={s.modalActions}><Button isDisabled={busy} onPress={() => setDetail(null)}>{t(readOnly ? 'Close' : 'Cancel')}</Button>{!readOnly && <Button variant="primary" isDisabled={busy || !detail.title.trim() || rows.some(row => !row.name.trim())} onPress={() => { patch(detail.id, detail); setDetail(null); }}>{t("Apply details")}</Button>}</div>}>
  <fieldset className={s.detail} disabled={locked}>
   <div className={s.detailTop}>{detail.photo && <img src={detail.photo} alt={detail.title}/>}<div className={s.form}><TextInput label={t("Item name")} maxLength={240} value={detail.title} onChange={title => setDetail({ ...detail, title })}/><TextAreaField label={t("Description")} maxLength={6000} value={detail.specification} onChange={specification => setDetail({ ...detail, specification })}/><Checkbox isSelected={Boolean(detail.optional)} onChange={optional => setDetail({ ...detail, optional })}>{t("Optional item (excluded from quotation total)")}</Checkbox></div></div>
   <div className={s.dimensionFields}><strong>{t("Finished dimensions")}</strong>{(['length', 'height', 'depth'] as const).map(key => <NumericInput key={key} label={t(dimensionText[key].label)} aria-label={t(dimensionText[key].item)} minValue={0} maxValue={1000000} value={detail.dimensions?.[key] ?? NaN} onChange={next => { const value = Number.isNaN(next) ? undefined : next; if (value !== undefined && (!Number.isFinite(value) || value < 0))
            return; setDetail({ ...detail, dimensions: { unit: detail.dimensions?.unit ?? 'mm', ...detail.dimensions, [key]: value } }); }}/>)}<SelectField label={t("Unit")} items={['mm', 'cm', 'm', 'in', 'ft'].map(unit => ({ id: unit, label: unit }))} selectedKey={detail.dimensions?.unit ?? 'mm'} onSelectionChange={key => key !== null && setDetail({ ...detail, dimensions: { ...detail.dimensions, unit: String(key) as NonNullable<QuoteLine['dimensions']>['unit'] } })}/></div>
   {detail.catalogLinks?.some(link => link.role === 'work') && <CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="variant" label={t("Item variant")} linkedTo={detail.catalogLinks.find(link => link.role === 'work')?.recordId} value={detail.catalogLinks.find(link => link.role === 'variant')?.snapshot ?? null} disabled={locked} onChange={choice => { if (choice)
            setDetail(selectVariant(detail, choice)); }}/>}
   <div className={s.materialHeading}><strong>{t("Materials, finishes & work")}</strong><span className={s.spacer}/><Button size="compact" isDisabled={locked || rows.length >= 40} onPress={() => materialRows([...rows, { id: crypto.randomUUID(), name: '', specification: '', type: 'material', quantity: 1, unit: 'nos', rate: 0, suppliedByClient: false }])}><Plus size={14}/>{t("Custom row")}</Button><Button size="compact" isDisabled={locked || rows.length >= 40} onPress={() => setMaterialPicker(!materialPicker)}>{t("From catalogue")}</Button></div>
   {materialPicker && <CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="material" label={t("Choose material")} value={null} disabled={locked} onChange={choice => { if (!choice)
            return; materialRows([...rows, { id: crypto.randomUUID(), name: choice.name, specification: choice.description ?? '', type: 'material', quantity: 1, unit: 'nos', rate: 0, suppliedByClient: false }]); setMaterialPicker(false); }}/>}
   <div className={s.tableScroll}><table className={`${s.table} ${s.materialTable}`}><thead><tr>{[tKey('Material / work'), tKey('Specification'), tKey('Type'), tKey('Qty'), tKey('Unit'), tKey('Rate'), tKey('Client supplied'), null].map((label, index) => <th key={index}>{label ? t(label) : ''}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><input aria-label={t("Material name")} maxLength={240} value={row.name} onChange={event => materialPatch(row.id, { name: event.target.value })}/></td><td><textarea aria-label={t('Specification for {name}', { name: row.name || t('material') })} rows={2} maxLength={3000} value={row.specification} onChange={event => materialPatch(row.id, { specification: event.target.value })}/></td><td><select aria-label={t('Type for {name}', { name: row.name || t('material') })} value={row.type} onChange={event => materialPatch(row.id, { type: event.target.value as QuotationMaterialRow['type'] })}>{([['material', tKey('material')], ['finish', tKey('finish')], ['labour', tKey('labour')], ['other', tKey('other')]] as const).map(([type, label]) => <option key={type} value={type}>{t(label)}</option>)}</select></td><td><QuotationNumberInput label={t('Material quantity for {name}', { name: row.name })} value={row.quantity} onChange={quantity => materialPatch(row.id, { quantity })}/></td><td><input aria-label={t('Material unit for {name}', { name: row.name })} maxLength={20} value={row.unit} onChange={event => materialPatch(row.id, { unit: event.target.value })}/></td><td><QuotationNumberInput label={t('Material rate for {name}', { name: row.name })} value={row.rate} money onChange={rate => materialPatch(row.id, { rate })}/></td><td><Checkbox aria-label={t('{name} supplied by client', { name: row.name || t('Material') })} isSelected={row.suppliedByClient} onChange={suppliedByClient => materialPatch(row.id, { suppliedByClient })}/></td><td><IconButton size="compact" aria-label={t('Remove material {name}', { name: row.name })} onPress={() => materialRows(rows.filter(item => item.id !== row.id))}><Trash2 aria-hidden="true" size={14}/></IconButton></td></tr>)}{!rows.length && <tr><td colSpan={8} className={s.emptyRow}>{t("Add materials, finishes, hardware or labour. Their specifications appear in the item description.")}</td></tr>}</tbody></table></div>
   <div className={s.materialHeading}><Checkbox isDisabled={locked || usesCatalogPricing(detail)} isSelected={detail.pricingMode === 'materials'} onChange={fromRows => setDetail(pricedLine({ ...detail, materialRows: rows, pricingMode: fromRows ? 'materials' : 'item' }))}>{t("Calculate item rate from these rows")}</Checkbox><span className={s.spacer}/><span>{t("Per 1 {unit}:", { unit: detail.unit })} <strong>{money(rows.reduce((sum, row) => sum + materialAmount(row), 0), quote.currency, locale)}</strong></span></div>
  </fieldset>
 </ControlledModalDialog>}
 {confirmationDialog}
 </div>;
}
