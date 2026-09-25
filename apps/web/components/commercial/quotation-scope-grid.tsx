'use client';
import { useRef, useState } from 'react';
import { Copy, ImagePlus, Plus, Search, Sparkles, Trash2, Pencil } from 'lucide-react';
import { ControlledModalDialog, useConfirmationDialog } from '@/design-system';
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
type Props = {
    quote: Quote;
    onChange: (quote: Quote, checkpoint?: boolean) => void;
    readOnly: boolean;
    workspaceId: string;
    caseId: string;
    canOverridePrice: boolean;
};
export function QuotationScopeGrid({ quote, onChange, readOnly, workspaceId, caseId, canOverridePrice }: Props) {
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
    function openAdd(room?: string) { setTargetRoom(room || rooms[0] || 'General'); setError(''); setItemDialog(true); }
    function openRoom(room?: string) { setOriginalRoom(room ?? null); setRoomName(room ?? ''); setRoomChoice(quote.rooms?.find(item => item.name === room)?.catalog?.snapshot ?? null); setError(''); setRoomDialog(true); }
    function saveRoom() { const name = roomName.trim(); if (!name)
        return; const current = latest.current; if (roomNames(current).some(room => room !== originalRoom && room.toLowerCase() === name.toLowerCase())) {
        setError('This room already exists.');
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
    function removeLine(line: QuoteLine) { requestConfirmation({ title: `Remove ${line.title}?`, body: 'You can undo this change.', confirmLabel: 'Remove item', onConfirm: () => { const current = latest.current; emit({ ...current, ...(current.presentation?.scopeColumns ? { presentation: { ...current.presentation, scopeColumns: { ...current.presentation.scopeColumns, custom: current.presentation.scopeColumns.custom.map(column => ({ ...column, values: Object.fromEntries(Object.entries(column.values).filter(([id]) => id !== line.id)) })) } } } : {}), lines: current.lines.filter(item => item.id !== line.id) }, true); } }); }
    function duplicateLine(line: QuoteLine) { if (quote.lines.length >= 300)
        return; const current = latest.current, index = current.lines.findIndex(item => item.id === line.id); const duplicate = { ...structuredClone(line), id: crypto.randomUUID() }; emit({ ...current, ...(current.presentation?.scopeColumns ? { presentation: { ...current.presentation, scopeColumns: { ...current.presentation.scopeColumns, custom: current.presentation.scopeColumns.custom.map(column => ({ ...column, values: { ...column.values, ...(column.values[line.id] !== undefined ? { [duplicate.id]: column.values[line.id] } : {}) } })) } } } : {}), lines: [...current.lines.slice(0, index + 1), duplicate, ...current.lines.slice(index + 1)] }, true); }
    function priceApply(basis: QuoteLine, currency: string, taxRate: number, changes: Partial<QuoteLine>) { const current = latest.current, line = current.lines.find(line => line.id === basis.id); if (!line || current.currency !== currency || current.taxRate !== taxRate || JSON.stringify(catalogPriceInput(line, currency, taxRate)) !== JSON.stringify(catalogPriceInput(basis, currency, taxRate)))
        return false; patch(line.id, changes); return true; }
    function applySuggestions(suggestions: RoomSuggestion[]) { const current = latest.current, next = addQuotationSuggestions(current, suggestions); const count = next.lines.length - current.lines.length; emit(next, true); setNotice(count ? `${count} suggested items added. Check dimensions, quantities and rates.` : 'These items are already in the quotation.'); }
    const builtins = [{ id: 'index', name: '#', width: 45 }, { id: 'image', name: 'Image', width: 110 }, { id: 'item', name: 'Item', width: 180 }, { id: 'description', name: 'Description & materials', width: 240 }, { id: 'dimensions', name: 'Dimensions', width: 170 }, { id: 'quantity', name: 'Qty', width: 65 }, { id: 'unit', name: 'Unit', width: 64 }, { id: 'rate', name: `Rate · ${quote.currency}`, width: 90 }, { id: 'pricing', name: 'Pricing', width: 145 }, { id: 'amount', name: `Amount · ${quote.currency}`, width: 100 }, { id: 'actions', name: 'Actions', width: 70 }];
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
    const rate = (line: QuoteLine) => usesCatalogPricing(line) || locked || line.pricingMode === 'materials' ? <span>{line.rate.toFixed(2)}</span> : <QuotationNumberInput label={`Rate for ${line.title}`} value={line.rate} money onChange={rate => patch(line.id, { rate })}/>;
    return <div className={s.workspace} data-assistant={ai || undefined}>
 <section className={s.main} aria-label="Quotation scope and pricing">
  <div className={s.toolbar}>
   <div><label className={s.search}><Search size={15}/><input aria-label="Search quotation items" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items…"/></label><div className={s.segment} aria-label="Item grouping"><button type="button" aria-pressed={group === 'room'} onClick={() => setGroup('room')}>By room</button><button type="button" aria-pressed={group === 'item'} onClick={() => setGroup('item')}>All items</button></div></div>
   <div><button type="button" disabled={locked} onClick={() => setColumnsOpen(true)}>Columns</button>{!readOnly && <><button type="button" disabled={!canAdd || rooms.length >= 100} onClick={() => openRoom()}><Plus size={15}/>Room</button><button type="button" className={s.primary} disabled={!canAdd || quote.lines.length >= 300} onClick={() => openAdd()}><Plus size={15}/>Add item</button><button type="button" aria-pressed={ai} disabled={!canAdd} onClick={() => setAi(!ai)}><Sparkles size={15}/>AI assist</button></>}</div>
  </div>
  {error && <p role="alert" className={s.error}>{error}</p>}{notice && <p role="status" className={s.notice}>{notice}</p>}
  <input ref={photoInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload item photo" onChange={event => void uploadPhoto(event.target.files?.[0])}/>
  <div className={s.tableScroll} tabIndex={0} aria-label="Quotation items table">
   <table style={{ minWidth: visible.reduce((sum, column) => sum + column.width, 0) + config.custom.length * 160 }} className={s.table}>
    <colgroup>{visible.map(column => <col key={column.id} style={{ width: column.width }}/>)}{config.custom.map(column => <col key={column.id} style={{ width: 160 }}/>)}</colgroup>
    <thead><tr>{visible.map(column => <th key={column.id} scope="col">{column.name}</th>)}{config.custom.map(column => <th key={column.id} scope="col">{column.name}</th>)}</tr></thead>
    {groups.map(({ name, lines }) => <tbody key={name || 'all'}>
     {name && <tr className={s.roomRow}><th colSpan={count} scope="rowgroup"><div><strong>{name}</strong><small>{lines.length} items</small><span className={s.spacer}/><span>{money(lines.reduce((sum, line) => sum + (line.optional ? 0 : roundMoney(line.quantity * line.rate)), 0), quote.currency)}</span>{!readOnly && <><button type="button" disabled={!canAdd} aria-label={`Add item to ${name}`} onClick={() => openAdd(name)}><Plus size={14}/>Add item</button><button type="button" disabled={locked} aria-label={`Edit ${name}`} onClick={() => openRoom(name)}><Pencil size={13}/></button></>}</div></th></tr>}
     {lines.map(line => <tr key={line.id} className={s.itemRow}>
      {!config.hidden.includes('index') && <td className={s.index}>{quote.lines.indexOf(line) + 1}</td>}
      {!config.hidden.includes('image') && <td><button type="button" className={s.photo} disabled={locked} aria-label={`${line.photo ? 'Replace' : 'Add'} image for ${line.title}`} onClick={() => { photoTarget.current = line.id; photoInput.current?.click(); }}>{line.photo ? <img src={line.photo} alt={line.title}/> : <ImagePlus size={22}/>}</button></td>}
      {!config.hidden.includes('item') && <td><input className={s.itemName} aria-label={`Item name ${quote.lines.indexOf(line) + 1}`} maxLength={240} value={line.title} disabled={locked} onChange={event => patch(line.id, { title: event.target.value })}/>{group === 'item' && <small>{line.room}</small>}{line.optional && <small>Optional · excluded from total</small>}<button type="button" className={s.textButton} onClick={() => { setDetail(structuredClone(line)); setMaterialPicker(false); }}>Materials & options</button></td>}
      {!config.hidden.includes('description') && <td><textarea aria-label={`Description for ${line.title}`} rows={3} maxLength={32000} value={line.specification} disabled={locked} placeholder="Enter description…" onChange={event => patch(line.id, { specification: event.target.value })}/>{(line.materialRows?.length || line.material || line.finish) ? <small>{quotationDescription({ ...line, specification: '' })}</small> : null}</td>}
      {!config.hidden.includes('dimensions') && <td><div className={s.inlineDimensions}>{(['length', 'height', 'depth'] as const).map(key => <label key={key}><span>{key[0].toUpperCase()}</span><input type="number" min={0} max={1000000} step="any" disabled={locked} aria-label={`${key} for ${line.title}`} placeholder="—" value={line.dimensions?.[key] ?? ''} onChange={event => { const value = event.target.value === '' ? undefined : Number(event.target.value); if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1000000))
                return; patch(line.id, { dimensions: { unit: 'mm', ...line.dimensions, [key]: value } }); }}/></label>)}<select aria-label={`Dimension unit for ${line.title}`} value={line.dimensions?.unit ?? 'mm'} disabled={locked} onChange={event => patch(line.id, { dimensions: { ...line.dimensions, unit: event.target.value as NonNullable<QuoteLine['dimensions']>['unit'] } })}>{['mm', 'cm', 'm', 'in', 'ft'].map(unit => <option key={unit}>{unit}</option>)}</select></div></td>}
      {!config.hidden.includes('quantity') && <td>{locked ? line.quantity : <QuotationNumberInput label={`Quantity for ${line.title}`} value={line.quantity} min={0.001} onChange={quantity => patch(line.id, { quantity })}/>}</td>}
      {!config.hidden.includes('unit') && <td><input aria-label={`Unit for ${line.title}`} maxLength={20} value={line.unit} disabled={locked} list="quotation-common-units" onChange={event => patch(line.id, customUnit(line, event.target.value))}/></td>}
      {!config.hidden.includes('rate') && <td className={s.numeric}>{rate(line)}</td>}
      <td className={s.pricingCell}>{usesCatalogPricing(line) ? <QuotationCatalogPrice line={line} currency={quote.currency} taxRate={quote.taxRate} workspaceId={workspaceId} caseId={caseId} readOnly={locked} canOverride={canOverridePrice} showRate={false} onApply={priceApply}/> : <span className={s.manualPrice}>Manual rate</span>}</td>
      {!config.hidden.includes('amount') && <td className={s.numeric}><strong>{roundMoney(line.quantity * line.rate).toFixed(2)}</strong></td>}
      {!config.hidden.includes('actions') && <td><div className={s.rowActions}><button type="button" disabled={locked || quote.lines.length >= 300 || quote.direction === 'deduction'} aria-label={`Duplicate ${line.title}`} onClick={() => duplicateLine(line)}><Copy size={14}/></button><button type="button" disabled={locked} aria-label={`Remove ${line.title}`} onClick={() => removeLine(line)}><Trash2 size={14}/></button></div></td>}
      {config.custom.map(column => <td key={column.id}><textarea rows={3} maxLength={2000} aria-label={`${column.name} for ${line.title}`} disabled={locked} value={column.values[line.id] ?? ''} placeholder="Enter value…" onChange={event => customCell(column.id, line.id, event.target.value)}/></td>)}
     </tr>)}
     {!lines.length && <tr><td colSpan={count} className={s.emptyRow}>{search ? 'No matching items.' : <>{name ? 'No items in this room.' : 'No items yet.'} {canAdd && <button type="button" onClick={() => openAdd(name)}><Plus size={14}/>Add item</button>}</>}</td></tr>}
    </tbody>)}
    {!groups.length && <tbody><tr><td colSpan={count} className={s.emptyRow}>{search ? 'No matching items.' : 'Start with a room or add your first item.'}</td></tr></tbody>}
   </table>
  </div>
  <datalist id="quotation-common-units">{['nos', 'pcs', 'set', 'm', 'm²', 'm³', 'ft', 'ft²', 'job', 'lot', 'hr'].map(unit => <option key={unit}>{unit}</option>)}</datalist>
  <footer className={s.totals}><span>{quote.lines.length} items</span><span className={s.spacer}/><span>Subtotal <strong>{money(totals.subtotal, quote.currency)}</strong></span><label>Discount {locked ? <strong>{money(quote.discount, quote.currency)}</strong> : <QuotationNumberInput label="Quotation discount" value={quote.discount} money max={totals.subtotal} onChange={discount => emit({ ...latest.current, discount })}/>}</label><label className={s.taxToggle}><input type="checkbox" role="switch" aria-label="Enable tax" checked={taxEnabled} disabled={locked} onChange={event => { const enabled = event.target.checked; setTaxEntryEnabled(enabled); if (!enabled)
        previousTaxRate.current = latest.current.taxRate; emit({ ...latest.current, taxRate: enabled ? previousTaxRate.current : 0 }, true); }}/>Tax</label>{taxEnabled && <label>Rate %{locked ? <strong>{quote.taxRate}</strong> : <QuotationNumberInput label="Quotation tax percentage" value={quote.taxRate} max={100} onChange={taxRate => { previousTaxRate.current = taxRate; emit({ ...latest.current, taxRate }); }}/>}</label>}<span>Tax <strong>{money(totals.tax, quote.currency)}</strong></span><span className={s.total}>Total <strong>{money(totals.total, quote.currency)}</strong></span></footer>
 </section>
 {ai && <QuotationScopeAssistant quote={quote} workspaceId={workspaceId} caseId={caseId} disabled={locked} onClose={() => setAi(false)} onApply={applySuggestions}/>}
 <ControlledModalDialog title="Columns" isOpen={columnsOpen} onOpenChange={setColumnsOpen} size="md">
 <div className={s.form}><p>Choose the columns to show. Hidden columns keep their values. Pricing status stays visible for review.</p><div className={s.columnChoices}>{configurableBuiltins.map(column => <label className={s.check} key={column.id}><input type="checkbox" checked={!config.hidden.includes(column.id)} disabled={locked || (!config.hidden.includes(column.id) && count === 2 && !config.custom.length)} onChange={event => configure({ ...config, hidden: event.target.checked ? config.hidden.filter(id => id !== column.id) : [...config.hidden, column.id] })}/>{column.name}</label>)}</div>
 {config.custom.map(column => <div className={s.customColumn} key={column.id}><input aria-label="Custom column name" maxLength={80} value={column.name} onChange={event => { if (event.target.value.trim())
        configure({ ...config, custom: config.custom.map(item => item.id === column.id ? { ...item, name: event.target.value } : item) }); }}/><button type="button" aria-label={`Delete column ${column.name}`} onClick={() => { requestConfirmation({ title: `Delete ${column.name}?`, body: 'This removes the column and its values. You can undo this change.', confirmLabel: 'Delete column', onConfirm: () => configure({ ...config, custom: config.custom.filter(item => item.id !== column.id) }) }); }}><Trash2 size={16}/></button></div>)}
 <label>New custom column<input value={columnName} maxLength={80} placeholder="For example: Brand, Finish code, Lead time" onChange={event => setColumnName(event.target.value)}/></label><button type="button" disabled={locked || !columnName.trim() || config.custom.length >= 20} onClick={() => { configure({ ...config, custom: [...config.custom, { id: crypto.randomUUID(), name: columnName.trim(), values: {} }] }); setColumnName(''); }}>Add column</button></div>
 </ControlledModalDialog>
 <ControlledModalDialog title={originalRoom ? 'Edit room / area' : 'Add room / area'} isOpen={roomDialog} onOpenChange={setRoomDialog} size="md" footer={<div className={s.modalActions}><button type="button" onClick={() => setRoomDialog(false)}>Cancel</button><button type="button" className={s.primary} disabled={locked || !roomName.trim()} onClick={saveRoom}>Save room</button></div>}>
  <div className={s.form}><CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="room" label="Room from catalogue (optional)" value={roomChoice} disabled={locked} onChange={choice => { setRoomChoice(choice); if (choice)
        setRoomName(choice.name); }}/><label>Room name<input value={roomName} maxLength={120} onChange={event => setRoomName(event.target.value)} disabled={locked}/></label>{error && <p role="alert">{error}</p>}</div>
 </ControlledModalDialog>
 {itemDialog && <QuotationItemBasket quote={quote} workspaceId={workspaceId} caseId={caseId} initialRoom={targetRoom} canCreate={canOverridePrice} onClose={() => setItemDialog(false)} onAdd={lines => { if (!canAdd)
        return; const current = latest.current; if (current.lines.length + lines.length > 300)
        throw new Error('This quotation supports up to 300 items.'); const names = roomNames(current), newRooms = [...new Set(lines.map(line => line.room))].filter(name => !names.includes(name)); emit({ ...current, rooms: [...(current.rooms ?? names.map(name => ({ id: crypto.randomUUID(), name }))), ...newRooms.map(name => ({ id: crypto.randomUUID(), name }))], lines: [...current.lines, ...lines] }, true); setNotice(`${lines.length} items added. Review their dimensions and prices.`); }}/>}
 {detail && <ControlledModalDialog title={detail.title || 'Item details'} isOpen onOpenChange={open => { if (!open && !busy)
            setDetail(null); }} size="xl" footer={<div className={s.modalActions}><button type="button" disabled={busy} onClick={() => setDetail(null)}>{readOnly ? 'Close' : 'Cancel'}</button>{!readOnly && <button type="button" className={s.primary} disabled={busy || !detail.title.trim() || rows.some(row => !row.name.trim())} onClick={() => { patch(detail.id, detail); setDetail(null); }}>Apply details</button>}</div>}>
  <fieldset className={s.detail} disabled={locked}>
   <div className={s.detailTop}>{detail.photo && <img src={detail.photo} alt={detail.title}/>}<div className={s.form}><label>Item name<input maxLength={240} value={detail.title} onChange={event => setDetail({ ...detail, title: event.target.value })}/></label><label>Description<textarea rows={3} maxLength={6000} value={detail.specification} onChange={event => setDetail({ ...detail, specification: event.target.value })}/></label><label className={s.check}><input type="checkbox" checked={Boolean(detail.optional)} onChange={event => setDetail({ ...detail, optional: event.target.checked })}/>Optional item (excluded from quotation total)</label></div></div>
   <div className={s.dimensionFields}><strong>Finished dimensions</strong>{(['length', 'height', 'depth'] as const).map(key => <label key={key}>{key}<input type="number" min={0} max={1000000} step="any" aria-label={`Item ${key}`} value={detail.dimensions?.[key] ?? ''} onChange={event => { const value = event.target.value === '' ? undefined : Number(event.target.value); if (value !== undefined && (!Number.isFinite(value) || value < 0))
            return; setDetail({ ...detail, dimensions: { unit: detail.dimensions?.unit ?? 'mm', ...detail.dimensions, [key]: value } }); }}/></label>)}<label>Unit<select value={detail.dimensions?.unit ?? 'mm'} onChange={event => setDetail({ ...detail, dimensions: { ...detail.dimensions, unit: event.target.value as NonNullable<QuoteLine['dimensions']>['unit'] } })}>{['mm', 'cm', 'm', 'in', 'ft'].map(unit => <option key={unit}>{unit}</option>)}</select></label></div>
   {detail.catalogLinks?.some(link => link.role === 'work') && <CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="variant" label="Item variant" linkedTo={detail.catalogLinks.find(link => link.role === 'work')?.recordId} value={detail.catalogLinks.find(link => link.role === 'variant')?.snapshot ?? null} disabled={locked} onChange={choice => { if (choice)
            setDetail(selectVariant(detail, choice)); }}/>}
   <div className={s.materialHeading}><strong>Materials, finishes & work</strong><span className={s.spacer}/><button type="button" disabled={locked || rows.length >= 40} onClick={() => materialRows([...rows, { id: crypto.randomUUID(), name: '', specification: '', type: 'material', quantity: 1, unit: 'nos', rate: 0, suppliedByClient: false }])}><Plus size={14}/>Custom row</button><button type="button" disabled={locked || rows.length >= 40} onClick={() => setMaterialPicker(!materialPicker)}>From catalogue</button></div>
   {materialPicker && <CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="material" label="Choose material" value={null} disabled={locked} onChange={choice => { if (!choice)
            return; materialRows([...rows, { id: crypto.randomUUID(), name: choice.name, specification: choice.description ?? '', type: 'material', quantity: 1, unit: 'nos', rate: 0, suppliedByClient: false }]); setMaterialPicker(false); }}/>}
   <div className={s.tableScroll}><table className={`${s.table} ${s.materialTable}`}><thead><tr>{['Material / work', 'Specification', 'Type', 'Qty', 'Unit', 'Rate', 'Client supplied', ''].map((label, index) => <th key={index}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><input aria-label="Material name" maxLength={240} value={row.name} onChange={event => materialPatch(row.id, { name: event.target.value })}/></td><td><textarea aria-label={`Specification for ${row.name || 'material'}`} rows={2} maxLength={3000} value={row.specification} onChange={event => materialPatch(row.id, { specification: event.target.value })}/></td><td><select aria-label={`Type for ${row.name || 'material'}`} value={row.type} onChange={event => materialPatch(row.id, { type: event.target.value as QuotationMaterialRow['type'] })}>{['material', 'finish', 'labour', 'other'].map(type => <option key={type}>{type}</option>)}</select></td><td><QuotationNumberInput label={`Material quantity for ${row.name}`} value={row.quantity} onChange={quantity => materialPatch(row.id, { quantity })}/></td><td><input aria-label={`Material unit for ${row.name}`} maxLength={20} value={row.unit} onChange={event => materialPatch(row.id, { unit: event.target.value })}/></td><td><QuotationNumberInput label={`Material rate for ${row.name}`} value={row.rate} money onChange={rate => materialPatch(row.id, { rate })}/></td><td><input type="checkbox" aria-label={`${row.name || 'Material'} supplied by client`} checked={row.suppliedByClient} onChange={event => materialPatch(row.id, { suppliedByClient: event.target.checked })}/></td><td><button type="button" aria-label={`Remove material ${row.name}`} onClick={() => materialRows(rows.filter(item => item.id !== row.id))}><Trash2 size={14}/></button></td></tr>)}{!rows.length && <tr><td colSpan={8} className={s.emptyRow}>Add materials, finishes, hardware or labour. Their specifications appear in the item description.</td></tr>}</tbody></table></div>
   <div className={s.materialHeading}><label className={s.check}><input type="checkbox" disabled={locked || usesCatalogPricing(detail)} checked={detail.pricingMode === 'materials'} onChange={event => setDetail(pricedLine({ ...detail, materialRows: rows, pricingMode: event.target.checked ? 'materials' : 'item' }))}/>Calculate item rate from these rows</label><span className={s.spacer}/><span>Per 1 {detail.unit}: <strong>{money(rows.reduce((sum, row) => sum + materialAmount(row), 0), quote.currency)}</strong></span></div>
  </fieldset>
 </ControlledModalDialog>}
 {confirmationDialog}
 </div>;
}
