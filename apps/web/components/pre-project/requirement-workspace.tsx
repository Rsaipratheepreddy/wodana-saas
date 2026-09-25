"use client";

import { useState } from 'react';
import { ClipboardList, DoorOpen, FileText, Plus, Ruler, Trash2 } from 'lucide-react';
import { Button, SelectField } from '@/design-system';
import { blankEntry, blankSpecification, caseApi, caseRequest, entryPayload, scopeLabels, specificationPayload, type CaseAsset, type CaseContent, type ItemDimension, type ItemSpecification, type ScopeEntry } from '@/lib/pre-project/content';
import { type RequirementNote } from '@/lib/crm/note-document';
import { RequirementNotesWorkspace, type NotesModel, type useRequirementNotes } from '../crm/requirement-notes';
import { CatalogChoiceField } from './case-controls';
import styles from './requirement-workspace.module.css';

function caseNote(entry: ScopeEntry): RequirementNote {
  return { id: `case:${entry.id}`, storage: 'case', scope: entry, version: entry.version, title: entry.title, note: entry.note, archived: Boolean(entry.archivedAt), pinned: entry.pinned, document: entry.document ?? undefined, assets: entry.assets, links: entry.referenceUrl ? [entry.referenceUrl] : [], updatedAt: entry.updatedAt, updatedByName: entry.createdByName };
}

type Props = {
  data: CaseContent;
  sharedNotes: ReturnType<typeof useRequirementNotes>;
  onSaved: (entry: ScopeEntry) => void;
  onSpecifications: (entry: ScopeEntry) => void;
  onRooms: () => void;
  onBrief: () => void;
  onPaste: () => void;
  onAddLayout: () => void;
  onOpenLayout: (entry: ScopeEntry) => void;
};

export function RequirementWorkspace({ data, sharedNotes, onSaved, onSpecifications, onRooms, onBrief, onPaste, onAddLayout, onOpenLayout }: Props) {
  const [refreshError, setRefreshError] = useState('');
  const [room, setRoom] = useState('all');
  const sharedItems = sharedNotes.items.map(note => note.scope ? { ...note, scope: data.entries.find(entry => entry.id === note.scope!.id && entry.version >= note.scope!.version) ?? note.scope } : note);
  const linked = new Set(sharedItems.flatMap(note => note.scope ? [note.scope.id] : []));
  const items = [...sharedItems, ...data.entries.filter(entry => ['requirement', 'note'].includes(entry.kind) && !linked.has(entry.id)).map(caseNote)];
  const layouts = data.entries.filter(entry => entry.kind === 'file' && !entry.archivedAt);
  const activeRequirements = items.filter(note => !note.archived).length;
  const measuredItems = items.filter(note => !note.archived && note.scope?.specification?.dimensions.some(dimension => dimension.measured != null)).length;
  const measurementCount = items.filter(note => !note.archived).reduce((total, note) => total + (note.scope?.specification?.dimensions.length ?? 0), 0);
  const model: NotesModel = {
    ...sharedNotes,
    items,
    failure: [sharedNotes.failure, refreshError].filter(Boolean).join(' '),
    refresh: () => { sharedNotes.refresh(); caseRequest<CaseContent>(data.workspaceId, data.caseId, 'brief').then(result => { result.entries.forEach(onSaved); setRefreshError(''); }).catch(error => setRefreshError(error.message)); },
    canEdit: data.canEdit,
    canEditNote: note => data.canEdit && (note.storage === 'case' || sharedNotes.canEdit),
    create: () => caseNote(blankEntry(room === 'all' || room === 'general' ? null : room)),
    fileUrl: (id, assetId, preview) => id.startsWith('case:') ? caseApi(data.workspaceId, data.caseId, `assets/${assetId}${preview ? '?preview=1' : ''}`) : sharedNotes.fileUrl(id, assetId, preview),
    upload: async (id, file, assetId) => {
      if (!id.startsWith('case:')) return sharedNotes.upload(id, file, assetId);
      const body = new FormData(); body.set('file', file);
      return caseRequest<CaseAsset>(data.workspaceId, data.caseId, `assets/${assetId}`, 'POST', body);
    },
    save: async note => {
      if (note.storage !== 'case') {
        const saved = await sharedNotes.save(note);
        if (saved.scope) onSaved(saved.scope);
        return saved;
      }
      const entry = { ...note.scope!, title: note.title.trim(), note: note.note, document: note.document, pinned: note.pinned, assets: note.assets ?? [] };
      const saved = await caseRequest<ScopeEntry>(data.workspaceId, data.caseId, 'entries', 'PUT', { ...entryPayload(entry), archived: note.archived });
      onSaved(saved);
      return caseNote(saved);
    },
  };
  const roomName = (note: RequirementNote) => data.rooms.find(item => item.id === note.scope?.roomId)?.name ?? note.scope?.roomName ?? 'Whole project';
  const noteSummary = (note: RequirementNote) => {
    const dimensions = note.scope?.specification?.dimensions ?? [];
    return [roomName(note), dimensions.length ? `${dimensions.length} measurement${dimensions.length === 1 ? '' : 's'}` : 'Not measured'].join(' · ');
  };
  return <div className={styles.siteWorkspace}>
    <header className={styles.workspaceHeader}>
      <div><span className={styles.eyebrow}>Site manager workspace</span><h2>Capture the site room by room</h2><p>Keep requirements, actual measurements and the latest plans together.</p></div>
      <div className={styles.workspaceActions}><Button size="compact" variant="quiet" onPress={onBrief}><ClipboardList size={14}/>Project brief</Button><Button size="compact" variant="quiet" onPress={onRooms}><DoorOpen size={14}/>Rooms</Button>{data.canEdit && <Button size="compact" variant="quiet" onPress={onPaste}>Paste list</Button>}</div>
    </header>
    <dl className={styles.captureSummary} aria-label="Site capture summary"><div><dt>Rooms</dt><dd>{data.rooms.length || '—'}</dd></div><div><dt>Requirements</dt><dd>{activeRequirements}</dd></div><div><dt>Measured</dt><dd>{activeRequirements ? `${measuredItems} of ${activeRequirements}` : '—'}</dd></div><div><dt>Sizes recorded</dt><dd>{measurementCount}</dd></div></dl>
    <section className={styles.layoutShelf} aria-labelledby="site-layouts-heading">
      <div className={styles.layoutHeading}><div><FileText size={16}/><span><strong id="site-layouts-heading">Site plans & layouts</strong><small>Floor plans, surveys and marked-up drawings</small></span></div>{data.canEdit && <Button size="compact" variant={layouts.length ? 'quiet' : 'primary'} onPress={onAddLayout}><Plus size={14}/>Add site plan</Button>}</div>
      {layouts.length ? <div className={styles.layoutList}>{layouts.map(layout => <button type="button" key={layout.id} className={styles.layoutRow} onClick={() => onOpenLayout(layout)}><FileText size={16}/><span><strong>{layout.title}</strong><small>{layout.roomName ?? 'Whole project'} · {layout.assets.length ? `${layout.assets.length} file${layout.assets.length === 1 ? '' : 's'}` : 'Linked plan'}</small></span><span>Edit</span></button>)}</div> : <p className={styles.emptyLayouts}>No site plan attached yet. Add it when one is available; requirements can start now.</p>}
    </section>
    <RequirementNotesWorkspace notes={model} simple listTitle="Room requirements" newLabel="Add requirement" summary={noteSummary}
      matches={note => room === 'all' || (note.scope?.roomId ?? 'general') === room}
      sidebarTools={<div className={styles.roomFilter}><SelectField label="Filter by room" selectedKey={room} onSelectionChange={key => key && setRoom(String(key))} items={[{ id: 'all', label: 'All rooms' }, { id: 'general', label: 'Whole project' }, ...data.rooms.map(item => ({ id: item.id, label: item.name }))]}/></div>}
      renderContext={(note, change, disabled, dirty) => <RequirementContext key={note.id} note={note} data={data} disabled={disabled} dirty={dirty} onChange={scope => change({ scope })} onRooms={onRooms} onSpecifications={onSpecifications} onSaved={onSaved}/>}
    />
  </div>;
}

function RequirementContext({ note, data, disabled, dirty, onChange, onSpecifications, onRooms, onSaved }: {
  note: RequirementNote; data: CaseContent; disabled: boolean; dirty: boolean;
  onChange: (entry: ScopeEntry) => void; onSpecifications: (entry: ScopeEntry) => void; onRooms: () => void; onSaved: (entry: ScopeEntry) => void;
}) {
  const [fresh] = useState(() => blankEntry());
  const [measurementMessage, setMeasurementMessage] = useState('');
  const scope = note.scope ?? fresh;
  const room = data.rooms.find(item => item.id === scope.roomId);
  const work = scope.catalogLinks.find(link => link.role === 'work');
  const patch = (value: Partial<ScopeEntry>) => onChange({ ...scope, ...value });
  const relation = (role: string, label: string) => <CatalogChoiceField workspaceId={data.workspaceId} caseId={data.caseId} kind={role} label={label}
    value={scope.catalogLinks.find(link => link.role === role)?.snapshot ?? null}
    relatedTo={role === 'work' && room?.catalogRecordId ? { role: 'room', recordId: room.catalogRecordId } : role === 'variant' && work ? { role: 'work', recordId: work.recordId } : undefined}
    disabled={disabled || (role === 'variant' && !work)} onChange={value => patch({
      ...(role === 'work' && value ? { kind: 'requirement' } : {}),
      ...(role === 'unit' ? { unit: value ? String(value.configuration?.symbol ?? value.code) : 'nos', quantity: null } : {}),
      catalogLinks: [...scope.catalogLinks.filter(link => link.role !== role && (role !== 'work' || link.role !== 'variant')), ...(value ? [{ role, recordId: value.id, snapshot: value }] : [])],
    })}/>;
  const select = (field: 'scopeStatus'|'reviewStatus'|'priority', label: string, values: string[]) => <SelectField label={label} isDisabled={disabled} selectedKey={scope[field]} onSelectionChange={key => key && patch({ [field]: String(key) })} items={values.map(id => ({ id, label: scopeLabels[id] }))}/>;
  return <div className={styles.context}>
    <div className={styles.roomRow}><SelectField label="Room / area" isDisabled={disabled} selectedKey={scope.roomId ?? 'general'} onSelectionChange={key => {
      if (!key) return;
      const id = key === 'general' ? null : String(key);
      patch({ roomId: id, roomName: data.rooms.find(item => item.id === id)?.name ?? null });
    }} items={[{ id: 'general', label: 'Whole project' }, ...data.rooms.map(item => ({ id: item.id, label: item.name }))]}/>{data.canEdit && <Button size="compact" variant="quiet" isDisabled={disabled} onPress={onRooms}>Manage rooms</Button>}</div>
    <SimpleMeasurements key={`${note.id}:${scope.specification?.version ?? 0}`} scope={scope} data={data} disabled={disabled} message={measurementMessage} onMessage={setMeasurementMessage} onSaved={onSaved}/>
    <section className={styles.details}><h3>More scope details · optional</h3>
      <div className={styles.fields}>{relation('work', 'Related item')}{relation('variant', 'Variant')}{relation('unit', 'Quantity unit')}<label>Quantity<input type="number" min="0.0001" max="1000000000" step="0.0001" value={scope.quantity ?? ''} disabled={disabled} onChange={event => patch({ quantity: event.target.value === '' ? null : Number(event.target.value) })} placeholder="If known"/></label>{relation('execution', 'Execution type')}{select('scopeStatus', 'Include in scope', ['undecided', 'included', 'excluded'])}{select('reviewStatus', 'Consultant review', ['captured', 'reviewed', 'clarification'])}{select('priority', 'Need or preference', ['must_have', 'preferred', 'optional'])}<label className={styles.full}>Constraints / avoid<textarea maxLength={3000} rows={2} value={scope.avoid} disabled={disabled} onChange={event => patch({ avoid: event.target.value })}/></label></div>
      <div className={styles.detailActions}>{scope.kind === 'requirement' && <Button size="compact" variant="quiet" isDisabled={!scope.version || dirty} onPress={() => onSpecifications(scope)}>{disabled ? 'View item details' : 'Materials & item details'}</Button>}{(!scope.version || dirty) && <span>Save the requirement before opening item details.</span>}</div>
    </section>
  </div>;
}

function SimpleMeasurements({ scope, data, disabled, message, onMessage, onSaved }: { scope: ScopeEntry; data: CaseContent; disabled: boolean; message: string; onMessage: (message: string) => void; onSaved: (entry: ScopeEntry) => void }) {
  const initial = scope.specification ?? blankSpecification();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(specificationPayload(draft)) !== JSON.stringify(specificationPayload(baseline));
  const editable = !disabled && scope.version > 0 && !scope.archivedAt;
  const change = (id: string, patch: Partial<ItemDimension>) => { onMessage(''); setDraft(current => ({ ...current, dimensions: current.dimensions.map(item => item.id === id ? { ...item, ...patch } : item) })); };
  const add = () => { onMessage(''); setDraft(current => ({ ...current, dimensions: [...current.dimensions, { id: crypto.randomUUID(), name: '', unit: 'mm', basis: 'site_opening', approximate: null, measured: null, source: 'team', evidence: '' }] })); };
  const save = async () => {
    const incomplete = draft.dimensions.find(item => !item.siteSurvey && (!item.name.trim() || (item.measured == null && item.approximate == null)));
    if (incomplete) { setError('Enter what was measured and an actual or estimated value.'); return; }
    setSaving(true); setError(''); onMessage('');
    try {
      const saved = await caseRequest<ItemSpecification>(data.workspaceId, data.caseId, `specifications/${scope.id}`, 'PUT', specificationPayload(draft));
      setDraft(saved); setBaseline(saved); onSaved({ ...scope, specification: saved }); onMessage('Measurements saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save measurements.'); }
    finally { setSaving(false); }
  };
  return <section className={styles.measurements} aria-label="Measurements">
    <div className={styles.measurementHeading}><div><strong><Ruler size={15}/>Measurements <span>{draft.dimensions.length}</span></strong><p>Record the actual site size. Add estimates or references only when useful.</p></div>{editable && <Button size="compact" variant="quiet" onPress={add}><Plus size={14}/>Add measurement</Button>}</div>
    {!scope.version && <p className={styles.measurementNotice}>Save this requirement first, then add its measurements here.</p>}
    {error && <p className={styles.measurementError} role="alert">{error}</p>}{message && <p className={styles.measurementSaved} role="status">{message}</p>}
    {draft.dimensions.length ? <div className={styles.measurementList}>{draft.dimensions.map((dimension, index) => dimension.siteSurvey ? <div className={styles.surveyMeasurement} key={dimension.id}><span><strong>{dimension.name}</strong><small>Survey record · {dimension.verification === 'verified' ? 'Verified' : dimension.verification === 'recheck' ? 'Recheck needed' : 'Awaiting verification'}</small></span><b>{dimension.measured ?? dimension.approximate ?? '—'} {dimension.unit}</b></div> : <div className={styles.measurementRow} key={dimension.id}>
      <div className={styles.measurementPrimary}><label>Measure<input aria-label={`Measurement ${index + 1} name`} disabled={!editable || saving} value={dimension.name} maxLength={120} placeholder="e.g. Wall width" onChange={event => change(dimension.id, { name: event.target.value })}/></label><label>Actual size<input aria-label={`${dimension.name || `Measurement ${index + 1}`} actual size`} disabled={!editable || saving} type="number" min="0.0001" max="1000000" step="0.0001" value={dimension.measured ?? ''} placeholder="Enter size" onChange={event => change(dimension.id, { measured: event.target.value === '' ? null : Number(event.target.value) })}/></label><label>Unit<select aria-label={`${dimension.name || `Measurement ${index + 1}`} unit`} disabled={!editable || saving} value={dimension.unit} onChange={event => change(dimension.id, { unit: event.target.value })}>{['mm', 'cm', 'm', 'in', 'ft'].map(unit => <option value={unit} key={unit}>{unit}</option>)}</select></label>{editable && <button className={styles.removeMeasurement} type="button" aria-label={`Remove measurement ${index + 1}`} disabled={saving} onClick={() => { onMessage(''); setDraft(current => ({ ...current, dimensions: current.dimensions.filter(item => item.id !== dimension.id) })); }}><Trash2 size={15}/></button>}</div>
      <section className={styles.measurementMore}><h3>Estimate or source · optional</h3><div className={styles.fields}><label>Estimated size<input disabled={!editable || saving} type="number" min="0.0001" max="1000000" step="0.0001" value={dimension.approximate ?? ''} onChange={event => change(dimension.id, { approximate: event.target.value === '' ? null : Number(event.target.value) })}/></label><label>Measured for<select disabled={!editable || saving} value={dimension.basis} onChange={event => change(dimension.id, { basis: event.target.value })}><option value="site_opening">Opening / available space</option><option value="finished_item">Finished item</option><option value="fabrication">Fabrication / cut size</option></select></label><label>Source<select disabled={!editable || saving} value={dimension.source} onChange={event => change(dimension.id, { source: event.target.value })}><option value="team">Our team</option><option value="client">Client supplied</option></select></label><label>Reference<input disabled={!editable || saving} maxLength={2000} value={dimension.evidence} placeholder="Photo, drawing or note" onChange={event => change(dimension.id, { evidence: event.target.value })}/></label></div></section>
    </div>)}</div> : scope.version > 0 && <p className={styles.noMeasurements}>No measurements yet. Add one when the site value is known.</p>}
    {dirty && <div className={styles.measurementSave}><Button size="compact" variant="primary" isLoading={saving} isDisabled={!editable} onPress={save}>Save measurements</Button><span>Measurement changes are saved separately from the requirement note.</span></div>}
  </section>;
}
