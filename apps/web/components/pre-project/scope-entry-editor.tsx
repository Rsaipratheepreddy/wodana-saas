"use client";

import { useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react';
import { Button, Checkbox, SelectField } from '@/design-system';
import { blankEntry, scopeLabels, type CaseAsset, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { AssetFiles, AssetUpload, CaseModal, CatalogChoiceField } from './case-controls';
import styles from './case-content.module.css';

const steps = ['Client need', 'References', 'Optional details'];
const recordNames = { requirement: 'requirement', inspiration: 'inspiration', file: 'site plan', note: 'requirement' };

type Props = {
  entry: ScopeEntry;
  data: CaseContent;
  onClose: () => void;
  onSave: (value: ScopeEntry) => Promise<ScopeEntry>;
  onArchive: (value: boolean) => Promise<void>;
  onSpecifications: () => void;
  assetUrl?: (asset: CaseAsset, preview?: boolean) => string;
  uploadFile?: (file: File, id: string) => Promise<CaseAsset>;
};

export function ScopeEditor({ entry, data, onClose, onSave, onArchive, onSpecifications, assetUrl, uploadFile }: Props) {
  const [draft, setDraft] = useState(entry);
  const [baseline, setBaseline] = useState(entry);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const writable = data.canEdit && !draft.archivedAt;
  const busy = saving || uploading;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const change = (key: keyof ScopeEntry, value: unknown) => setDraft(d => ({ ...d, [key]: value }));
  const move = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => stepHeading.current?.focus());
  };
  const invalid = (at: number, text: string) => { move(at); setError(text); return false; };
  const validate = (all = false) => {
    if (!draft.title.trim()) return invalid(0, 'Enter a short title for the client’s request.');
    if (draft.referenceUrl && (all || step === 1)) {
      try { const url = new URL(draft.referenceUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); }
      catch { return invalid(1, 'Enter a complete reference link, starting with https://.'); }
    }
    if (all && draft.kind === 'file' && !draft.assets.length) return invalid(1, 'Attach a site layout before saving.');
    if (all || step === 2) {
      if (draft.quantity !== null && (!Number.isFinite(draft.quantity) || draft.quantity <= 0 || draft.quantity > 1e9 || !/^\d+(\.\d{1,4})?$/.test(String(draft.quantity)))) return invalid(2, 'Enter a positive quantity with up to 4 decimals, or leave it empty.');
      if (!draft.unit.trim() || !draft.category.trim()) return invalid(2, 'Enter a unit and category, or keep the suggested values.');
    }
    setError('');
    return true;
  };
  const goTo = (next: number) => { if (next <= step || validate()) move(next); };
  const select = (key: keyof ScopeEntry, label: string, options: string[]) => <SelectField label={label} isDisabled={!writable || busy} selectedKey={String(draft[key])} onSelectionChange={k => k && change(key, String(k))} items={options.map(id => ({ id, label: scopeLabels[id] ?? id.charAt(0).toUpperCase() + id.slice(1) }))} />;
  const relation = (role: string, label: string) => <CatalogChoiceField key={role} workspaceId={data.workspaceId} caseId={data.caseId} kind={role} label={label} value={draft.catalogLinks.find(l => l.role === role)?.snapshot ?? null} disabled={!writable || busy || (role === 'variant' && !draft.catalogLinks.some(l => l.role === 'work'))} onChange={value => setDraft(d => ({ ...d, ...(role === 'unit' ? { unit: value ? String(value.configuration?.symbol ?? value.code) : 'nos', quantity: null } : {}), catalogLinks: [...d.catalogLinks.filter(l => l.role !== role && (role !== 'work' || l.role !== 'variant')), ...(value ? [{ role, recordId: value.id, snapshot: value }] : [])] }))} />;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !writable || !validate(true)) return;
    setSaving(true);
    try {
      const saved = await onSave(draft);
      if (addAnother) {
        const next = { ...blankEntry(saved.roomId), kind: saved.kind, source: saved.source, category: saved.category };
        setDraft(next); setBaseline(next); move(0); setMessage('Saved. Add the next request.');
      } else onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save. Your entry is still here.'); }
    finally { setSaving(false); }
  };

  return <CaseModal size="md" title={draft.version ? draft.title : `Add ${recordNames[draft.kind]}`} description="Capture the client’s words. You can fill in the details later." onClose={onClose} dirty={dirty} busy={busy} footer={<div className={styles.stepFooter}>
    {step > 0 && <Button size="compact" isDisabled={busy} onPress={() => goTo(step - 1)}><ArrowLeft size={14} />Back</Button>}
    {writable && <Button size="compact" form="scope-form" type="submit" variant={step === 2 ? 'primary' : 'secondary'} isDisabled={uploading} isLoading={saving}>Save {recordNames[draft.kind]}</Button>}
    {step < 2 && <Button size="compact" variant="primary" isDisabled={busy} onPress={() => goTo(step + 1)}>Continue<ArrowRight size={14} /></Button>}
  </div>}>
    <nav aria-label="Capture steps" className={styles.stepper}><ol>{steps.map((label, index) => <li key={label}><button type="button" disabled={busy} aria-current={step === index ? 'step' : undefined} onClick={() => goTo(index)}><span className={styles.stepNumber}>{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span><span>{label}</span></button></li>)}</ol></nav>
    <form id="scope-form" noValidate onSubmit={save} className={styles.captureForm}>
      <h3 tabIndex={-1} ref={stepHeading} className={styles.captureHeading}>Step {step + 1} of 3 · {step === 0 ? draft.kind === 'requirement' ? 'What does the client need?' : 'What would you like to capture?' : step === 1 ? 'Photos, files or a link' : 'Add only what you know'}</h3>
      {error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={styles.notice}>{message}</p>}
      {step === 0 && <fieldset disabled={!writable || busy} className={styles.captureFields}>
        <SelectField label="Room" isDisabled={!writable || busy} selectedKey={draft.roomId ?? 'general'} onSelectionChange={k => k && change('roomId', k === 'general' ? null : String(k))} items={[{ id: 'general', label: 'Whole project' }, ...data.rooms.map(r => ({ id: r.id, label: r.name }))]} />
        <label>{draft.kind === 'requirement' ? 'Client requirement' : 'Title'}<input required maxLength={240} value={draft.title} onChange={e => change('title', e.target.value)} placeholder={draft.kind === 'requirement' ? 'e.g. Need more wardrobe storage' : 'Give this reference a short title'} /></label>
        <label>Client notes · optional<textarea rows={3} maxLength={6000} value={draft.note} onChange={e => change('note', e.target.value)} placeholder="Their words, rough dimensions or preferences…" /></label>
      </fieldset>}
      {step === 1 && <fieldset disabled={!writable || busy} className={styles.captureFields}>
        <p className={styles.muted}>{draft.kind === 'file' ? 'Attach a site plan, drawing or layout reference.' : 'Optional. Add what the client shared, or save without attachments.'}</p>
        <AssetFiles workspaceId={data.workspaceId} caseId={data.caseId} assets={draft.assets} assetUrl={assetUrl} onMarked={writable && !busy ? asset => setDraft(current => ({...current, assets: [...current.assets, asset]})) : undefined} onRemove={writable && !busy ? id => change('assets', draft.assets.filter(a => a.id !== id)) : undefined} />
        {writable && <AssetUpload currentCount={draft.assets.length} workspaceId={data.workspaceId} caseId={data.caseId} uploadFile={uploadFile} disabled={busy || draft.assets.length >= 20} onBusy={setUploading} onError={setError} onUploaded={asset => setDraft(d => ({ ...d, assets: [...d.assets, asset] }))} />}
        <label>Reference link · optional<input type="url" maxLength={2000} value={draft.referenceUrl} onChange={e => change('referenceUrl', e.target.value)} placeholder="https://…" /></label>
      </fieldset>}
      {step === 2 && <fieldset disabled={busy} className={styles.captureFields}>
        {draft.kind === 'requirement' && <><div className={styles.grid}><label>Quantity · optional<input readOnly={!writable} inputMode="decimal" type="number" min="0.0001" max="1000000000" step="0.0001" value={draft.quantity ?? ''} onChange={e => change('quantity', e.target.value === '' ? null : Number(e.target.value))} placeholder="If known" /></label><label>Unit<input required maxLength={20} readOnly={!writable || draft.catalogLinks.some(l => l.role === 'unit')} value={draft.unit} onChange={e => change('unit', e.target.value)} /></label></div>
          <details><summary>Link catalog records · optional</summary><div className={styles.captureFields}>{relation('work', 'Catalog item')}{relation('unit', 'Catalog unit')}<div className={styles.grid}>{relation('variant', 'Variant')}{relation('execution', 'Execution type')}</div></div></details>
        </>}
        <details><summary>More context · optional</summary><div className={styles.captureFields}><label>Constraints / avoid<textarea readOnly={!writable} rows={2} maxLength={3000} value={draft.avoid} onChange={e => change('avoid', e.target.value)} /></label><div className={styles.grid}><label>Category<input readOnly={!writable} required maxLength={60} value={draft.category} onChange={e => change('category', e.target.value)} /></label>{select('source', 'Captured from', ['team', 'client'])}</div></div></details>
        {draft.version > 0 && <details><summary>Team decisions & record settings</summary><div className={styles.grid}>{draft.kind === 'requirement' && <>{select('scopeStatus', 'Scope decision', ['undecided', 'included', 'excluded'])}{select('priority', 'Need or preference', ['must_have', 'preferred', 'optional'])}{select('reviewStatus', 'Consultant review', ['captured', 'reviewed', 'clarification'])}</>}{select('kind', 'Record type', ['requirement', 'note', 'inspiration', 'file'])}</div>
          <div className={styles.recordActions}>{draft.kind === 'requirement' && !draft.id.startsWith('requirement-note:') && <Button size="compact" isDisabled={busy || dirty} onPress={onSpecifications}>Item specifications</Button>}{data.canEdit && <Button size="compact" isDisabled={busy || dirty} onPress={async () => { setSaving(true); try { await onArchive(!draft.archivedAt); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.'); } finally { setSaving(false); } }}>{draft.archivedAt ? <RotateCcw size={14} /> : <Archive size={14} />}{draft.archivedAt ? 'Restore' : 'Archive'}</Button>}</div>
        </details>}
      </fieldset>}
      {writable && <div className={styles.captureAnother}><Checkbox isDisabled={busy} isSelected={addAnother} onChange={setAddAnother}>Add another after saving</Checkbox></div>}
    </form>
  </CaseModal>;
}
