"use client";

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, SelectField } from '@/design-system';
import { blankSpecification, caseRequest, specificationPayload, type CaseContent, type ItemDimension, type ItemSpecification, type ScopeEntry } from '@/lib/pre-project/content';
import { CaseModal } from './case-controls';
import styles from './case-content.module.css';

type Props = {
  data: CaseContent;
  entries: ScopeEntry[];
  initialEntryId?: string;
  initialRoom: string;
  onClose: () => void;
  onCreateRequirement: () => void;
  onSaved: (entry: ScopeEntry, specification: ItemSpecification) => void;
};

export function MeasurementCreateForm({ data, entries, initialEntryId, initialRoom, onClose, onCreateRequirement, onSaved }: Props) {
  const [entryId, setEntryId] = useState(() => {
    if (initialEntryId) return initialEntryId;
    const matching = entries.filter(item => initialRoom === 'all' || (item.roomId ?? 'general') === initialRoom);
    return matching.length === 1 ? matching[0].id : '';
  });
  const [dimension, setDimension] = useState<ItemDimension>(() => ({ id: crypto.randomUUID(), name: '', unit: 'mm', basis: 'site_opening', approximate: null, measured: null, source: 'team', evidence: '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = entries.find(item => item.id === entryId);
  const dirty = Boolean(dimension.name || dimension.measured !== null || dimension.approximate !== null || dimension.evidence);
  const disabled = saving || !data.canEdit;
  const patch = (value: Partial<ItemDimension>) => setDimension(current => ({ ...current, ...value }));
  return <CaseModal size="md" title="Add measurement" description="Choose what you measured and record its site size." dirty={dirty} busy={saving} onClose={onClose}
    footer={entries.length > 0 && data.canEdit && <Button type="submit" form="new-measurement-form" variant="primary" isLoading={saving}>Save measurement</Button>}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {entries.length ? <form id="new-measurement-form" onSubmit={async event => {
      event.preventDefault();
      if (disabled) return;
      if (!selected) { setError('Choose the requirement this measurement belongs to.'); return; }
      if (!dimension.name.trim() || dimension.measured === null || !dimension.evidence.trim()) { setError('Enter the dimension name, actual size and measurement source.'); return; }
      const baseline = selected.specification ?? blankSpecification();
      if (baseline.dimensions.length >= 40) { setError('This requirement already has 40 dimensions. Open its measurement card to edit an existing one.'); return; }
      setSaving(true); setError('');
      try {
        const saved = await caseRequest<ItemSpecification>(data.workspaceId, data.caseId, `specifications/${selected.id}`, 'PUT', specificationPayload({ ...baseline, dimensions: [...baseline.dimensions, { ...dimension, name: dimension.name.trim(), evidence: dimension.evidence.trim() }] }));
        onSaved(selected, saved);
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save. Your measurement is still here.'); }
      finally { setSaving(false); }
    }}><fieldset disabled={disabled} className={styles.captureFields}>
      <SelectField label="Requirement" placeholder="Choose a room / requirement…" isDisabled={disabled} selectedKey={entryId || null} onSelectionChange={key => key && setEntryId(String(key))} items={entries.map(item => ({ id: item.id, label: `${data.rooms.find(room => room.id === item.roomId)?.name ?? item.roomName ?? 'Whole project'} · ${item.title}` }))}/>
      <label>Dimension name<input autoFocus required maxLength={120} value={dimension.name} placeholder="e.g. Wall width or ceiling height" onChange={event => patch({ name: event.target.value })}/></label>
      <div className={styles.grid}>
        <label>Actual size<input required type="number" min="0.0001" max="1000000" step="0.0001" value={dimension.measured ?? ''} placeholder="Enter size" onChange={event => patch({ measured: event.target.value === '' ? null : Number(event.target.value) })}/></label>
        <SelectField label="Unit" isDisabled={disabled} selectedKey={dimension.unit} items={['mm', 'cm', 'm', 'in', 'ft'].map(id => ({ id, label: id }))} onSelectionChange={key => { if (key && key !== dimension.unit) patch({ unit: String(key), approximate: null, measured: null }); }}/>
      </div>
      <label>Measurement source<input required maxLength={2000} value={dimension.evidence} placeholder="e.g. Site visit on 9 Sep, laser measure" onChange={event => patch({ evidence: event.target.value })}/></label>
      <details><summary>Estimate & source details · optional</summary><div className={styles.captureFields}>
        <label>Approximate size ({dimension.unit})<input type="number" min="0.0001" max="1000000" step="0.0001" value={dimension.approximate ?? ''} onChange={event => patch({ approximate: event.target.value === '' ? null : Number(event.target.value) })}/></label>
        <SelectField label="Measured area" isDisabled={disabled} selectedKey={dimension.basis} items={[{ id: 'site_opening', label: 'Site opening / space' }, { id: 'finished_item', label: 'Finished item' }, { id: 'fabrication', label: 'Fabrication / cut size' }]} onSelectionChange={key => key && patch({ basis: String(key) })}/>
        <SelectField label="Source" isDisabled={disabled} selectedKey={dimension.source} items={[{ id: 'team', label: 'Measured by our team' }, { id: 'client', label: 'Client supplied' }]} onSelectionChange={key => key && patch({ source: String(key) })}/>
      </div></details>
    </fieldset></form> : <div className={styles.captureFields}><p className={styles.muted}>Add the room requirement first so its measurements stay together. The measurement form will open after you save it.</p>{data.canEdit && <Button variant="primary" onPress={onCreateRequirement}><Plus size={14}/>Add requirement</Button>}</div>}
  </CaseModal>;
}
