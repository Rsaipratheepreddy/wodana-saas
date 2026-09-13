"use client";
import { useEffect, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { ControlledModalDialog } from '@/design-system';
import type { Quote } from '@/lib/commercial/types';
import { applyRoom, roomNames } from '@/lib/commercial/room-builder';
import { roomKey } from '@/lib/commercial/quotation-proposal';
import { useCatalogOptions } from './catalog-options-cache';
import type { CommercialCatalogChoice } from './catalog-picker';
import s from './quotation-workspace.module.css';

export function QuotationRoomLibrary({ quote, workspaceId, caseId, onApply, onCustom, onClose }: { quote: Quote; workspaceId: string; caseId: string; onApply: (quote: Quote) => void; onCustom: () => void; onClose: () => void }) {
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<CommercialCatalogChoice[]>([]);
  const [master, setMaster] = useState<{ catalogId?: string; loading: boolean; error: string }>({ loading: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/quotation-assist/catalog?${new URLSearchParams({ workspaceId, caseId })}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'Master Data could not be loaded.');
        if (!controller.signal.aborted) setMaster({ catalogId: data.catalogId, loading: false, error: '' });
      }).catch(error => { if (!controller.signal.aborted) setMaster({ loading: false, error: error.message }); });
    return () => controller.abort();
  }, [workspaceId, caseId, attempt]);
  const options = useCatalogOptions(workspaceId, caseId, 'room', search, undefined, master.catalogId, Boolean(master.catalogId));
  const { items } = options, loading = master.loading || options.loading, error = master.error || options.error;
  const refresh = () => { if (master.error) { setMaster({ loading: true, error: '' }); setAttempt(value => value + 1); } else options.refresh(); };
  const existing = new Set(roomNames(quote).map(roomKey));
  const available = Math.max(0, 100 - existing.size);
  const toggle = (room: CommercialCatalogChoice) => setSelected(current => current.some(value => value.id === room.id) ? current.filter(value => value.id !== room.id) : current.length < available ? [...current, room] : current);
  return <ControlledModalDialog title="Add rooms" size="lg" isOpen onOpenChange={open => { if (!open) onClose(); }} footer={<div className={s.modalFooter}><span>{selected.length} selected</span><div><button className={s.button} onClick={onClose}>Cancel</button><button className={s.primary} disabled={!selected.length} onClick={() => { let next = quote; for (const room of selected) { let name = room.name, index = 2; while (roomNames(next).some(value => roomKey(value) === roomKey(name))) name = `${room.name} ${index++}`; next = applyRoom(next, null, name, room, []); } onApply(next); onClose(); }}>Add {selected.length || ''} {selected.length === 1 ? 'room' : 'rooms'}</button></div></div>}>
    <div className={s.library}><label className={s.search}><Search size={15}/><input autoFocus type="search" aria-label="Search rooms" placeholder="Find a room…" value={search} onChange={e => setSearch(e.target.value)}/></label>
      <p className={s.hint}>Select one or more rooms, then configure their items.</p>
      {loading && <p role="status">Loading rooms…</p>}{error && <p role="alert">{error} <button onClick={refresh}>Retry</button></p>}
      <div className={s.libraryGrid}>{items.map(room => { const added = existing.has(roomKey(room.name)), checked = selected.some(value => value.id === room.id); return <button key={room.id} className={s.roomChoice} aria-pressed={checked} disabled={!checked && selected.length >= available} onClick={() => toggle(room)}><span>{room.name}</span>{added && <small>Add another</small>}<span className={s.choiceCheck} data-checked={checked || undefined}>{checked && <Check size={12}/>}</span></button>; })}</div>
      {!loading && !error && !items.length && <p className={s.hint}>{master.catalogId ? 'No matching rooms.' : 'Add rooms to Master Data or create a custom room below.'}</p>}
      <button className={s.linkButton} onClick={onCustom}><Plus size={14}/>Custom room</button>
    </div>
  </ControlledModalDialog>;
}
