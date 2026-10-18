"use client";

import { useState, type FormEvent } from 'react';
import { Button, Checkbox, TextInput, VisuallyHidden } from '@/design-system';
import { blankEntry, caseApi, caseRequest, type CaseAsset, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { AssetFiles, CaseModal } from './case-controls';
import styles from './case-content.module.css';
import { AssetMarkup } from './asset-markup';
import { NoteRichEditor } from '../crm/note-rich-editor';
import { documentText, mediaIds, textDocument } from '@/lib/crm/note-document';
import { useT } from '@/lib/i18n/i18n-provider';
import { tKey } from '@/lib/i18n/keys';

const saveLabels = { requirement: tKey('Save requirement'), inspiration: tKey('Save inspiration'), file: tKey('Save site plan'), note: tKey('Save project note') };

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

export function ScopeEditor({ entry, data, onClose, onSave, assetUrl, uploadFile }: Props) {
  const t = useT();
  const [draft, setDraft] = useState(entry);
  const [baseline, setBaseline] = useState(entry);
  const [marking, setMarking] = useState<CaseAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const writable = data.canEdit && !draft.archivedAt;
  const busy = saving || uploading;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const change = (key: keyof ScopeEntry, value: unknown) => setDraft(d => ({ ...d, [key]: value }));
  const invalid = (_at: number, text: string) => { setError(text); return false; };
  const validate = () => {
    if (draft.note.length > 6000) return invalid(0, t('Keep the requirement text within 6,000 characters.'));
    if (!draft.title.trim()) return invalid(0, t('Enter a short title for the client’s request.'));
    if (draft.referenceUrl) {
      try { const url = new URL(draft.referenceUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); }
      catch { return invalid(1, t('Enter a complete reference link, starting with https://.')); }
    }
    if (draft.kind === 'file' && !draft.assets.length) return invalid(1, t('Attach a site layout before saving.'));
    {
      if (draft.quantity !== null && (!Number.isFinite(draft.quantity) || draft.quantity <= 0 || draft.quantity > 1e9 || !/^\d+(\.\d{1,4})?$/.test(String(draft.quantity)))) return invalid(2, t('Enter a positive quantity with up to 4 decimals, or leave it empty.'));
      if (!draft.unit.trim() || !draft.category.trim()) return invalid(2, t('Enter a unit and category, or keep the suggested values.'));
    }
    setError('');
    return true;
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !writable || !validate()) return;
    setSaving(true);
    try {
      const saved = await onSave(draft);
      if (addAnother) {
        const next = { ...blankEntry(saved.roomId), kind: saved.kind, source: saved.source, category: saved.category };
        setDraft(next); setBaseline(next); setMessage(t('Saved. Add the next request.'));
      } else onClose();
    } catch (err) { setError(err instanceof Error ? err.message : t('Could not save. Your entry is still here.')); }
    finally { setSaving(false); }
  };

  return <><CaseModal layout="sheet" size="lg" title={t(draft.kind === "requirement" ? "Enquiry requirements" : draft.kind === "inspiration" ? "Inspiration" : draft.kind === "file" ? "Site plan" : "Project note")} onClose={onClose} dirty={dirty} busy={busy} footer={writable ? <Button size="compact" form="scope-form" type="submit" variant="primary" isDisabled={uploading} isLoading={saving}>{t(saveLabels[draft.kind])}</Button> : undefined}>
    <form id="scope-form" noValidate onSubmit={save} className={styles.captureForm}>

      {error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={styles.notice}>{message}</p>}
      {<fieldset disabled={!writable || busy} className={styles.captureFields}>
        <div className={styles.documentHeading}><TextInput label={<VisuallyHidden>{t(draft.kind === 'requirement' ? 'Client requirement' : 'Title')}</VisuallyHidden>} isRequired maxLength={240} value={draft.title} onChange={value => change('title', value)} placeholder={t(draft.kind === 'requirement' ? 'e.g. Need more wardrobe storage' : 'Give this reference a short title')} /></div>
        <NoteRichEditor compact label={t(draft.kind === "file" ? "Site plan notes" : draft.kind === "inspiration" ? "Inspiration notes" : "Requirement notes")} placeholder={draft.kind === "file" ? t("Add the plan, then note its rooms, measurements or references…") : draft.kind === "inspiration" ? t("Add photos, links and what the client likes about them…") : undefined} key={draft.id} document={draft.document ?? textDocument(draft.note)} assets={draft.assets} writable={Boolean(writable)} disabled={busy} onDraw={writable && !busy && draft.assets.length < 20 ? setMarking : undefined} assetUrl={assetUrl ?? ((asset, preview) => caseApi(data.workspaceId, data.caseId, `assets/${asset.id}${preview ? '?preview=1' : ''}`))} onChange={document => setDraft(current => ({ ...current, document, note: documentText(document.content) }))} onAsset={asset => setDraft(current => ({ ...current, assets: [...current.assets.filter(item => item.id !== asset.id), asset] }))} onBusy={setUploading} onError={setError} onUpload={uploadFile ?? (async (file, id) => { if (file.type.startsWith('video/')) throw new Error(t('Use a video reference link, or upload an image or PDF.')); const body = new FormData(); body.set('file', file); return caseRequest<CaseAsset>(data.workspaceId, data.caseId, `assets/${id}`, 'POST', body); })}/>

      </fieldset>}
      <AssetFiles onDraw={writable && !busy && draft.assets.length < 20 ? setMarking : undefined} workspaceId={data.workspaceId} caseId={data.caseId} assets={draft.assets.filter(asset => !mediaIds((draft.document ?? textDocument(draft.note)).content).has(asset.id))} assetUrl={assetUrl} onRemove={writable && !busy ? id => change('assets', draft.assets.filter(a => a.id !== id)) : undefined} />
      {writable && entry.version === 0 && <div className={styles.captureAnother}><Checkbox isDisabled={busy} isSelected={addAnother} onChange={setAddAnother}>{t('Add another after saving')}</Checkbox></div>}
    </form>
  </CaseModal>{marking && <AssetMarkup workspaceId={data.workspaceId} caseId={data.caseId} asset={marking} assetUrl={assetUrl} uploadFile={uploadFile} onClose={() => setMarking(null)} onSaved={asset => { setDraft(current => ({ ...current, assets: [...current.assets, asset] })); setMarking(null); setMessage(t('Marked copy attached. Save the requirement to keep it.')); }}/> }</>;
}
