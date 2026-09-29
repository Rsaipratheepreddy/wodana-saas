"use client";

import { useId, useState } from 'react';
import { Archive, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Checkbox, Form, IconButton, SearchInput, TextAreaField, TextInput, useDesignSystem } from '@/design-system';
import { plainNoteDraft, requirementNoteLinks, safeNoteLink, type RequirementNote } from '@/lib/crm/note-document';
import type { CaseAsset, ScopeEntry } from '@/lib/pre-project/content';
import { AssetFiles, AssetUpload, CaseModal } from '../pre-project/case-controls';
import { ScopeNoteCards } from '../pre-project/scope-note-cards';
import type { NotesModel } from './requirement-notes';
import styles from './lead-requirement-notes.module.css';
import { Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

/** The lead drawer uses the same cards as Requirement gathering, not a nested notebook. */
export function LeadRequirementNotes({ notes, workspaceId, leadId }: { notes: NotesModel & { entries: ScopeEntry[] }; workspaceId: string; leadId: string }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<RequirementNote | null>(null);
  const [message, setMessage] = useState('');
  const { locale } = useDesignSystem();
  const byEntry = new Map(notes.items.map(note => [`requirement-note:${note.id}`, note]));
  const entries = notes.entries.filter(entry => Boolean(entry.archivedAt) === archived && `${entry.title} ${entry.note}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const add = () => { setMessage(''); setEditing({ id: crypto.randomUUID(), version: 0, title: '', note: '', archived: false, assets: [], links: [] }); };
  return <section aria-label={t("Requirement notes")} className={styles.notes}>
    <div className={styles.toolbar}>
      <SearchInput label={t("Search notes")} placeholder={t("Search requirement notes…")} value={search} onChange={setSearch} />
      <div className={styles.actions}><Checkbox isSelected={archived} onChange={setArchived}>{t("Archived")}</Checkbox><IconButton size="compact" aria-label={t("Refresh requirement notes")} onPress={notes.refresh}><RefreshCw size={15}/></IconButton>{notes.canEdit && <Button size="compact" variant="primary" isDisabled={notes.loading} onPress={add}><Plus size={15}/>{t("Add note")}</Button>}</div>
    </div>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {notes.failure && <p role="alert" className={styles.error}>{notes.failure}<Button size="compact" variant="quiet" onPress={notes.refresh}>{t("Retry")}</Button></p>}
    {notes.loading ? <Skeleton lines={4} /> : <ScopeNoteCards key={`${search}:${archived}`} entries={entries} workspaceId={workspaceId} caseId={leadId} locale={locale} requirementNotes canEdit={notes.canEdit}
      assetUrl={(entry, asset, preview) => notes.fileUrl(byEntry.get(entry.id)!.id, asset.id, preview)}
      emptyTitle={search ? t('No matching notes') : archived ? t('No archived notes') : t('No requirement notes yet')} emptyDescription={search ? t('Try a different search.') : archived ? t('Archived notes remain available here.') : t('Add the client’s requirements, photos or references.')}
      onOpen={entry => { setMessage(''); setEditing(byEntry.get(entry.id)!); }} onSpecifications={() => {}} />}
    {editing && <LeadRequirementNoteForm key={editing.id} note={editing} workspaceId={workspaceId} leadId={leadId} canEdit={notes.canEdit} onClose={() => setEditing(null)}
      assetUrl={(asset, preview) => notes.fileUrl(editing.id, asset.id, preview)} onUpload={(file, id) => notes.upload(editing.id, file, id)}
      onSave={async draft => { await notes.save(draft); setEditing(null); setMessage(draft.archived ? t('Note archived.') : editing.archived ? t('Note restored.') : t('Requirement note saved.')); if (draft.archived !== editing.archived) setArchived(draft.archived); }} />}
  </section>;
}

export function LeadRequirementNoteForm({ note, workspaceId, leadId, canEdit, onClose, onSave, onUpload, assetUrl }: {
  note: RequirementNote; workspaceId: string; leadId: string; canEdit: boolean; onClose: () => void; onSave: (note: RequirementNote) => Promise<void>;
  onUpload: (file: File, id: string) => Promise<CaseAsset>; assetUrl: (asset: CaseAsset, preview?: boolean) => string;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => ({ ...note, links: requirementNoteLinks(note) }));
  const [baseline] = useState(() => ({ ...note, links: requirementNoteLinks(note) }));
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const formId = useId();
  const busy = saving || uploading, writable = canEdit && !note.archived;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = async (archive = draft.archived) => {
    if (busy || !canEdit) return;
    if (!draft.title.trim()) { setError(t('Enter a title for this requirement note.')); return; }
    setError('');
    let value: RequirementNote;
    try {
      const links = [...new Set(draft.links.filter(link => link.trim()).map(safeNoteLink))];
      if (links.length > 20) throw new Error(t('Keep up to 20 reference links in one note.'));
      value = plainNoteDraft(note, { ...draft, title: draft.title.trim(), links, archived: archive });
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('Check the reference links.')); return; }
    setSaving(true);
    try { await onSave(value); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Could not save. Your changes are still here.')); }
    finally { setSaving(false); }
  };
  return <CaseModal size="md" title={note.title ? t('Requirement note') : t('Add requirement note')} dirty={dirty} busy={busy} onClose={onClose}
    footer={<>{canEdit && note.title && <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void save(!draft.archived)}>{note.archived ? <RotateCcw size={14}/> : <Archive size={14}/>} {note.archived ? t('Restore note') : t('Archive note')}</Button>}{writable && <Button size="compact" variant="primary" form={formId} type="submit" isLoading={saving} isDisabled={busy || (!dirty && note.version > 0)}>{t("Save note")}</Button>}</>}>
    <Form id={formId} className={styles.noteForm} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!writable && <p className={styles.message}>{note.archived ? t('Archived · restore this note to edit it.') : t('Read only')}</p>}
      <fieldset disabled={busy} className={styles.fields}>
        <TextInput isReadOnly={!writable} isRequired label={t("Title")} maxLength={240} onChange={title => setDraft(previous => ({ ...previous, title }))} placeholder={t("e.g. Kitchen storage requirements")} value={draft.title} />
        <TextAreaField isReadOnly={!writable} label={t("Requirement notes")} maxLength={60000} onChange={note => setDraft(previous => ({ ...previous, note }))} placeholder={t("Capture what the client needs, in their words…")} value={draft.note} />
        <div className={styles.pin}><Checkbox isSelected={Boolean(draft.pinned)} isDisabled={!writable || busy} onChange={pinned => setDraft(previous => ({ ...previous, pinned }))}>{t("Pin this note")}</Checkbox></div>
      </fieldset>
      <section className={styles.references} aria-label={t("Photos and files")}><h3>{t("Photos & files")}</h3>
        <AssetFiles workspaceId={workspaceId} caseId={leadId} assets={draft.assets ?? []} assetUrl={assetUrl} onRemove={writable && !busy ? id => setDraft(previous => ({ ...previous, assets: previous.assets?.filter(asset => asset.id !== id) })) : undefined}/>
        {writable ? <AssetUpload workspaceId={workspaceId} caseId={leadId} uploadFile={onUpload} currentCount={draft.assets?.length ?? 0} disabled={busy} onBusy={setUploading} onError={setError} onUploaded={asset => setDraft(previous => ({ ...previous, assets: [...previous.assets ?? [], asset] }))}/> : !draft.assets?.length && <p className={styles.message}>{t("No files attached.")}</p>}
      </section>
      <section className={styles.references} aria-label={t("Reference links")}><div className={styles.referenceHeading}><h3>{t("Reference links")}</h3>{writable && <Button size="compact" variant="quiet" isDisabled={busy || draft.links.length >= 20} onPress={() => setDraft(previous => ({ ...previous, links: [...previous.links, ''] }))}><Plus size={14}/>{t("Add link")}</Button>}</div>
        {draft.links.map((link, index) => <div key={index} className={styles.linkRow}>{writable ? <><TextInput inputType="url" isDisabled={busy} label={t("Link {number}", { number: index + 1 })} maxLength={2000} onChange={next => setDraft(previous => ({ ...previous, links: previous.links.map((value, i) => i === index ? next : value) }))} placeholder="https://…" value={link} /><IconButton aria-label={t("Remove link {number}", { number: index + 1 })} isDisabled={busy} onPress={() => setDraft(previous => ({ ...previous, links: previous.links.filter((_, i) => i !== index) }))}><Trash2 size={15}/></IconButton></> : <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>}</div>)}
        {!draft.links.length && <p className={styles.message}>{t("No reference links.")}</p>}
      </section>
    </Form>
  </CaseModal>;
}
