"use client";

import { useState } from 'react';
import { Button, FormSection, InlineNotice, SelectField, TextInput } from '@/design-system';
import { blankEntry, entryPayload, blankSpecification, caseRequest, specificationPayload, type CatalogChoice, type CaseContent, type ItemDimension, type ItemSpecification, type ScopeEntry } from '@/lib/pre-project/content';
import { CaseModal, CatalogChoiceField } from './case-controls';
import styles from './case-content.module.css';
import { MeasurementFields } from './measurement-fields';
import { useT } from '@/lib/i18n/i18n-provider';

type Props = {
  data: CaseContent;
  entries: ScopeEntry[];
  initialEntryId?: string;
  initialRoom: string;
  onClose: () => void;
  onCreateRequirement: () => void;
  onSaved: (entry: ScopeEntry, specification: ItemSpecification) => void;
};

export function MeasurementCreateForm({ data, entries, initialEntryId, initialRoom, onClose, onSaved }: Props) {
  const t = useT();
  const [entryId, setEntryId] = useState(() => {
    if (initialEntryId) return initialEntryId;
    const matching = entries.filter(item => initialRoom === 'all' || item.roomId === initialRoom);
    return matching.length === 1 ? matching[0].id : '';
  });
  const [name, setName] = useState('');
  const [catalog, setCatalog] = useState<CatalogChoice|null>(null);
  const [created, setCreated] = useState<ScopeEntry|null>(null);
  const [newId] = useState(()=>crypto.randomUUID());
  const [dimension, setDimension] = useState<ItemDimension>(() => ({ id: crypto.randomUUID(), name: '', unit: 'mm', basis: 'site_opening', approximate: null, measured: null, source: 'team', evidence: '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = entries.find(item => item.id === entryId);
  const dirty = Boolean(name || catalog || dimension.name || dimension.measured !== null || dimension.approximate !== null || dimension.evidence);
  const disabled = saving || !data.canEdit;
  const patch = (value: Partial<ItemDimension>) => setDimension(current => ({ ...current, ...value }));
  return <CaseModal size="md" title={t("Add measurement")} dirty={dirty} busy={saving} onClose={onClose}
    footer={data.canEdit && <Button type="submit" form="new-measurement-form" variant="primary" isLoading={saving}>{t("Save measurement")}</Button>}>
    {error && <InlineNotice tone="error" message={error} />}
    {<form id="new-measurement-form" onSubmit={async event => {
      event.preventDefault();
      if (disabled) return;
      if (!selected && !name.trim()) { setError(t('Enter an item name or choose a catalog item.')); return; }
      if (!dimension.name.trim() || dimension.measured === null || !Number.isFinite(dimension.measured) || dimension.measured <= 0) { setError(t('Choose a measurement type and enter its size.')); return; }
      const baseline = selected?.specification ?? blankSpecification();
      if (baseline.dimensions.length >= 40) { setError(t('This item already has 40 measurements. Edit an existing measurement.')); return; }
      setSaving(true); setError('');
      try {
        const item = selected ?? created ?? await caseRequest<ScopeEntry>(data.workspaceId,data.caseId,'entries','PUT',entryPayload({...blankEntry(initialRoom==='all'?null:initialRoom),id:newId,title:name.trim(),catalogLinks:catalog?[{role:'work',recordId:catalog.id,snapshot:catalog}]:[]}));
        if(!selected) setCreated(item);
        const saved = await caseRequest<ItemSpecification>(data.workspaceId, data.caseId, `specifications/${item.id}`, 'PUT', specificationPayload({ ...baseline, dimensions: [...baseline.dimensions, { ...dimension, name: dimension.name.trim(), evidence: dimension.evidence.trim() }] }));
        onSaved(item, saved);
      } catch (caught) { setError(caught instanceof Error ? caught.message : t('Could not save. Your measurement is still here.')); }
      finally { setSaving(false); }
    }}><fieldset disabled={disabled} className={styles.captureFields}>
      <FormSection title={t("Item")}>
      {entries.length>0 && <SelectField label={t('Item')} isDisabled={disabled||Boolean(created)} selectedKey={entryId || 'new'} onSelectionChange={key=>setEntryId(key==='new'?'':String(key))} items={[{id:'new',label:t('New item')},...entries.map(item=>({id:item.id,label:item.title}))]}/>}
      {!selected && <>
        <CatalogChoiceField workspaceId={data.workspaceId} caseId={data.caseId} kind="work" label={t("Catalog item (optional)")} disabled={disabled||Boolean(created)} value={catalog} onChange={value=>{setCatalog(value);if(value)setName(value.name);}}/>
        <TextInput label={t("Item name")} isRequired isDisabled={disabled||Boolean(created)} value={name} maxLength={240} onChange={setName} placeholder={t("e.g. Kitchen cabinet or bedroom wall")}/>
      </>}
      </FormSection>
      <FormSection title={t("Measurement")}>
        <MeasurementFields value={dimension} onChange={patch} disabled={disabled} requireMeasured />
      </FormSection>
    </fieldset></form>}
  </CaseModal>;
}
