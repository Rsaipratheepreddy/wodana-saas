"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Archive, ArrowLeft, Check, FileText, Pin, Plus, RefreshCw, Search, Undo2 } from 'lucide-react';
import { Button, IconButton, useConfirmationDialog, useDesignSystem } from '@/design-system';
import { crmRequest } from '@/lib/crm/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { translateKnown } from '@/lib/i18n/keys';
import { entryPayload, caseRequest, type CaseAsset, type ScopeEntry } from '@/lib/pre-project/content';
import { CaseModal } from '../pre-project/case-controls';
import { documentText, mediaIds, noteDocument, textDocument, type RequirementNote } from '@/lib/crm/note-document';
export type { RequirementNote } from '@/lib/crm/note-document';
import styles from './requirement-notes.module.css';
import { LeadRequirementNotes } from './lead-requirement-notes';

function EditorLoading() { const t = useT(); return <p role="status">{t('Opening editor…')}</p>; }
const NoteRichEditor = dynamic(() => import('./note-rich-editor').then(module => module.NoteRichEditor), { loading: EditorLoading });

type NotesData = { items: RequirementNote[]; canEdit: boolean };
type NotesTarget = { workspaceId: string; leadId?: string; caseId?: string };
const noteEntryId = (id: string) => `requirement-note:${id}`;

/** Reuses the same records and editor in Leads and Requirement gathering. */
export function useRequirementNotes({ workspaceId, leadId, caseId }: NotesTarget, enabled = true) {
  const t = useT();
  const fileUrl = (noteId: string, assetId: string, preview = false) => `/api/workspace/requirement-notes/${caseId ? 'case' : 'lead'}/${caseId ?? leadId}/${noteId}/assets/${assetId}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: '1' } : {}) })}`;
  const [data, setData] = useState<NotesData | null>(null), [failure, setFailure] = useState(''), [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<RequirementNote | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const read = caseId ? caseRequest<NotesData>(workspaceId, caseId, 'requirement-notes') : crmRequest<NotesData>(workspaceId, `leads/${leadId}/requirement-notes`);
    read.then(value => { if (active) { setData(value); setFailure(''); } }).catch(error => { if (active) setFailure(error.message); });
    return () => { active = false; };
  }, [workspaceId, caseId, leadId, revision, enabled]);
  const notesByEntryId = new Map((data?.items ?? []).map(note => [noteEntryId(note.id), note]));
  const entries: ScopeEntry[] = (data?.items ?? []).map(n => ({ ...n, id: noteEntryId(n.id), kind: 'note', roomId: null, createdByName: n.updatedByName, category: '', priority: 'preferred', scopeStatus: 'undecided', reviewStatus: 'captured', quantity: null, unit: '', referenceUrl: n.links?.[0] ?? '', avoid: '', source: 'team', assets: n.assets ?? [], catalogLinks: [], archivedAt: n.archived ? n.updatedAt || 'archived' : null }));
  const save = async (draft: RequirementNote) => {
    const input = { ...(draft.scope ? {scope:entryPayload({...draft.scope,title:draft.title.trim(),note:draft.note})} : {}), id: draft.id, version: draft.version, title: draft.title.trim(), note: draft.note, archived: draft.archived, pinned: Boolean(draft.pinned), ...(draft.document ? { document: draft.document } : {}), assetIds: (draft.assets ?? []).map(a => a.id), links: draft.links ?? [] };
    const result = caseId ? await caseRequest<NotesData>(workspaceId, caseId, 'requirement-notes', 'PUT', input) : await crmRequest<NotesData>(workspaceId, `leads/${leadId}/requirement-notes`, 'PUT', input);
    setData(result); setFailure('');
    return result.items.find(n => n.id === draft.id)!;
  };
  const upload = async (noteId: string, file: File, id: string) => { const body = new FormData(); body.set('file', file); const response = await fetch(fileUrl(noteId, id), { method: 'POST', body }); const result = await response.json(); if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join('. ') : result.message ?? t('Upload failed.')); return result as CaseAsset; };
  return {
    items: data?.items ?? [], save, upload, fileUrl, entries, canEdit: Boolean(data?.canEdit), loading: !data && !failure, failure,
    refresh: () => setRevision(n => n + 1),
    hasEntry: (entry: ScopeEntry) => notesByEntryId.has(entry.id),
    assetUrl: (entry: ScopeEntry, asset: CaseAsset, preview = false) => fileUrl(notesByEntryId.get(entry.id)!.id, asset.id, preview),
    add: () => setEditing({ id: crypto.randomUUID(), version: 0, title: '', note: '', archived: false }),
    open: (entry: ScopeEntry) => { const note = notesByEntryId.get(entry.id); if (note) setEditing(note); },
    update: async (entry: ScopeEntry) => {
      const original = notesByEntryId.get(entry.id);
      if (!original || !data?.canEdit || original.archived) throw new Error(t('This requirement cannot be edited.'));
      await save({ ...original, title: entry.title, note: entry.note, ...(original.note !== entry.note ? { document: textDocument(entry.note) } : {}) });
    },
    editor: editing && <RequirementNoteEditor key={editing.id} note={editing} canEdit={Boolean(data?.canEdit)} assetUrl={(asset, preview) => fileUrl(editing.id, asset.id, preview)} onUpload={(file, id) => upload(editing.id, file, id)} onClose={() => setEditing(null)} onSave={async draft => { await save(draft); setEditing(null); }} />,
  };
}

export function RequirementNotes(target: NotesTarget) {
  const notes = useRequirementNotes(target);
  if (target.leadId) return <LeadRequirementNotes key={target.leadId} notes={notes} workspaceId={target.workspaceId} leadId={target.leadId}/>;
  return <RequirementNotesWorkspace notes={notes}/>;
}

export type NotesModel = Pick<ReturnType<typeof useRequirementNotes>, 'items' | 'save' | 'upload' | 'fileUrl' | 'canEdit' | 'loading' | 'failure' | 'refresh'> & {
  create?: () => RequirementNote;
  canEditNote?: (note: RequirementNote) => boolean;
};
export type NoteContextRenderer = (note: RequirementNote, onChange: (patch: Partial<RequirementNote>) => void, disabled: boolean, dirty: boolean) => ReactNode;
export function RequirementNotesWorkspace({ notes, renderContext, newLabel: newLabelProp, listTitle: listTitleProp, sidebarTools, matches = () => true, summary, simple = false }: { notes: NotesModel; renderContext?: NoteContextRenderer; newLabel?: string; listTitle?: string; sidebarTools?: ReactNode; matches?: (note: RequirementNote) => boolean; summary?: (note: RequirementNote) => string; simple?: boolean }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const newLabel = newLabelProp ?? t('New note'), listTitle = listTitleProp ?? t('Requirement notes');
  const [selectedId, setSelectedId] = useState<string | null>(null), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RequirementNote>>({}), [busy, setBusy] = useState(false), [mobileEditor, setMobileEditor] = useState(false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const modified = Object.keys(drafts).length;
  useEffect(() => {
    if (!modified) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => { const anchor = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null; if (anchor && !anchor.target && anchor.href !== window.location.href) { event.preventDefault(); event.stopImmediatePropagation(); requestConfirmation({ title: t('Leave with unsaved notes?'), body: t(modified === 1 ? '{count} unsaved note will be discarded.' : '{count} unsaved notes will be discarded.', { count: modified }), confirmLabel: t('Discard and leave'), onConfirm: () => window.location.assign(anchor.href) }); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [modified, requestConfirmation, t]);
  const combined = new Map(notes.items.map(n => [n.id, n]));
  Object.values(drafts).forEach(n => combined.set(n.id, n));
  const items = [...combined.values()].filter(n => n.archived === archived).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const filtered = items.filter(n => matches(n) && `${n.title} ${n.note} ${summary?.(n) ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const selected = (selectedId ? drafts[selectedId] ?? filtered.find(note => note.id === selectedId) : null) ?? filtered[0];
  const change = (value: RequirementNote) => { setSelectedId(value.id); setDrafts(current => ({ ...current, [value.id]: value })); };
  const select = (id: string) => { if (!busy) { setSelectedId(id); setMobileEditor(true); } };
  const add = () => { const fresh: RequirementNote = notes.create?.() ?? { id: crypto.randomUUID(), version: 0, title: '', note: '', archived: false, document: textDocument(''), assets: [], links: [] }; change(fresh); setArchived(false); setSearch(''); select(fresh.id); };
  const save = async (draft: RequirementNote) => {
    const saved = await notes.save(draft);
    setDrafts(current => { const next = { ...current }; delete next[draft.id]; return next; });
    if (saved.archived !== archived) { setSelectedId(null); setMobileEditor(false); }
    return saved;
  };
  return <section className={styles.workspace} aria-label={listTitle} data-mobile-editor={mobileEditor || undefined} data-simple={simple || undefined}>
    <aside className={styles.noteSidebar} aria-label={t('Notes list')}>
      <div className={styles.listHeader}><strong>{archived ? t('Archived {list}', { list: listTitle.toLowerCase() }) : listTitle} <span>{items.length}</span></strong>{notes.canEdit && <Button variant="primary" size="compact" isDisabled={busy || notes.loading} onPress={add}><Plus size={14}/>{newLabel}</Button>}</div>
      <div className={styles.noteSearch}><Search size={15}/><input aria-label={t('Search notes')} placeholder={t('Search notes…')} value={search} onChange={e => setSearch(e.target.value)}/>{search && <button type="button" aria-label={t('Clear search')} onClick={() => setSearch('')}>×</button>}</div>
      {sidebarTools}
      {notes.failure && <p className={styles.error} role="alert">{translateKnown(t, notes.failure)}<Button size="compact" onPress={notes.refresh}>{t('Retry')}</Button></p>}
      <div className={styles.noteList}>
        {notes.loading && !filtered.length ? <p className={styles.emptyList} role="status">{t('Loading notes…')}</p> : !filtered.length ? <p className={styles.emptyList}>{t(search ? 'No matching notes.' : archived ? 'No archived notes.' : 'Capture the first requirement.')}</p> : filtered.map(note => <button type="button" key={note.id} className={styles.noteRow} aria-current={note.id === selected?.id ? 'true' : undefined} aria-label={t('Open {name}', { name: note.title || t('Untitled note') })} onClick={() => select(note.id)} disabled={busy}>
          <span className={styles.noteTitle}><strong>{note.title || t('Untitled note')}</strong>{note.pinned && <Pin size={13} aria-label={t('Pinned')}/>}</span><span className={styles.notePreview}>{note.note.trim() || (note.assets?.length ? t('{count} attached files', { count: note.assets.length }) : t('Start writing…'))}</span>{summary?.(note) && <span className={styles.noteContextSummary}>{summary(note)}</span>}<span className={styles.noteMeta}>{drafts[note.id] ? <span className={styles.unsaved}>{t('Unsaved')}</span> : note.updatedAt ? <time dateTime={note.updatedAt}>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(new Date(note.updatedAt))}</time> : <span>{t('From enquiry')}</span>}{Boolean(note.assets?.length) && <span>{t(note.assets!.length === 1 ? '{count} file' : '{count} files', { count: note.assets!.length })}</span>}</span>
        </button>)}
      </div>
      <div className={styles.listFooter}><button type="button" disabled={busy} onClick={() => { setArchived(!archived); setSelectedId(null); setSearch(''); }}><Archive size={14}/>{t(archived ? 'All notes' : 'Archived')}</button><IconButton size="compact" aria-label={t('Refresh requirement notes')} isDisabled={busy} onPress={notes.refresh}><RefreshCw size={14}/></IconButton></div>
    </aside>
    <div className={styles.editorPanel}>
      {selected ? <RequirementNotePane key={`${selected.id}:${selected.version}`} note={selected} dirty={Boolean(drafts[selected.id])} renderContext={renderContext} simple={simple} canEdit={notes.canEditNote?.(selected) ?? notes.canEdit} onChange={change} onSave={save} onBusy={setBusy} onBack={() => setMobileEditor(false)} onUpload={(file, id) => notes.upload(selected.id, file, id)} assetUrl={(asset, preview) => notes.fileUrl(selected.id, asset.id, preview)}/> : <div className={styles.emptyEditor}><FileText size={28}/><h3>{t('Your requirements, in one place')}</h3><p>{t('Write a note, add references, and keep every detail together.')}</p>{notes.canEdit && <Button variant="primary" size="compact" onPress={add}><Plus size={14}/>{newLabel}</Button>}</div>}
    </div>
    {confirmationDialog}
  </section>;
}

function RequirementNoteContext({renderContext,note,onChange,disabled,dirty}:{renderContext:NoteContextRenderer;note:RequirementNote;onChange:(patch:Partial<RequirementNote>)=>void;disabled:boolean;dirty:boolean}) {
  return renderContext(note,onChange,disabled,dirty);
}

type PaneProps = { renderContext?: NoteContextRenderer; simple?: boolean; note: RequirementNote; dirty: boolean; canEdit: boolean; onChange: (note: RequirementNote) => void; onSave: (note: RequirementNote) => Promise<RequirementNote | void>; onBusy?: (busy: boolean) => void; onBack?: () => void; onUpload?: (file: File, id: string) => Promise<CaseAsset>; assetUrl?: (asset: CaseAsset, preview?: boolean) => string };
function RequirementNotePane({ renderContext, simple = false, note, dirty, canEdit, onChange, onSave, onBusy, onBack, onUpload, assetUrl = () => '' }: PaneProps) {
  const t = useT();
  const latest = useRef(note);
  useLayoutEffect(() => { latest.current = note; });
  const assetCache = useRef(new Map((note.assets ?? []).map(asset => [asset.id, asset])));
  const [cachedAssets, setCachedAssets] = useState(note.assets ?? []);
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  // One initial document per note keeps selection and undo history stable while saving.
  const [initialDocument] = useState(() => noteDocument(note));
  const writable = canEdit && !note.archived, locked = saving || uploading;
  const change = (patch: Partial<RequirementNote>) => { const next = { ...latest.current, ...patch }; latest.current = next; onChange(next); };
  const save = async (patch: Partial<RequirementNote> = {}) => {
    if (locked || !canEdit) return;
    const value = { ...latest.current, ...patch };
    if (!value.title.trim()) { setError(t('Give this note a title.')); return; }
    if (value.note.length > 60000) { setError(t('Keep each note under 60,000 characters.')); return; }
    setSaving(true); onBusy?.(true); setError('');
    try { await onSave(value); } catch (e) { setError(e instanceof Error ? translateKnown(t, e.message) : t('Could not save. Your draft is kept.')); }
    finally { setSaving(false); onBusy?.(false); }
  };
  const status = t(uploading ? 'Uploading…' : saving ? 'Saving…' : note.archived ? 'Archived · read only' : !canEdit ? 'Read only' : dirty ? 'Unsaved changes' : 'Saved');
  return <div className={styles.notePane}>
    <div className={styles.editorHeader}>
      {onBack && <button className={styles.mobileBack} type="button" aria-label={t('Back to notes')} disabled={locked} onClick={onBack}><ArrowLeft size={16}/></button>}
      <span className={styles.saveStatus} role="status">{!dirty && !locked && writable && <Check size={13}/>} {status}</span>
      <div className={styles.editorActions}>{writable && <button className={styles.pinButton} type="button" aria-pressed={Boolean(note.pinned)} disabled={locked} onClick={() => change({ pinned: !note.pinned })}><Pin size={14}/>{t(note.pinned ? 'Pinned' : 'Pin')}</button>}{canEdit && note.title && <button type="button" disabled={locked} onClick={() => void save({ archived: !note.archived })}>{note.archived ? <Undo2 size={14}/> : <Archive size={14}/>} {t(note.archived ? 'Restore' : 'Archive')}</button>}{writable && <Button size="compact" variant="primary" isDisabled={locked || !dirty || !note.title.trim()} isLoading={saving} onPress={() => void save()}>{t(note.version || note.updatedAt ? 'Save changes' : 'Save note')}</Button>}</div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}

    <NoteRichEditor simple={simple} document={initialDocument} writable={writable} disabled={locked} assets={cachedAssets} assetUrl={assetUrl} onUpload={onUpload} onAsset={asset => { assetCache.current.set(asset.id, asset); setCachedAssets([...assetCache.current.values()]); change({ assets: [...(latest.current.assets ?? []), asset] }); }} onBusy={value => { setUploading(value); onBusy?.(value); }} onError={setError} onChange={document => change({ document, note: documentText(document.content), assets: [...mediaIds(document.content)].flatMap(id => { const asset = assetCache.current.get(id); return asset ? [asset] : []; }) })}>    <div className={styles.documentTitle}><input aria-label={t(simple ? 'Requirement title' : 'Note title')} placeholder={t(simple ? 'What is needed?' : 'Short title, e.g. Reception wall finish')} value={note.title} readOnly={!writable} disabled={locked} maxLength={240} onChange={e => change({ title: e.target.value })}/></div>{renderContext && <RequirementNoteContext renderContext={renderContext} note={note} onChange={change} disabled={!writable || locked} dirty={dirty}/>}</NoteRichEditor>
    <div className={styles.editorFooter}><span>{t('{count} words', { count: note.note.trim() ? note.note.trim().split(/\s+/).length : 0 })}</span><span>{note.updatedByName ? t('Edited by {name}', { name: note.updatedByName }) : t('Requirements')}{writable && ` · ${t('Paste or drop images and files')}`}</span></div>
  </div>;
}

export function RequirementNoteEditor({ note, canEdit, onClose, onSave, onUpload, assetUrl }: { note: RequirementNote; canEdit: boolean; onClose: () => void; onSave: (draft: RequirementNote) => Promise<void>; onUpload?: (file: File, id: string) => Promise<CaseAsset>; assetUrl?: (asset: CaseAsset, preview?: boolean) => string }) {
  const t = useT();
  const [draft, setDraft] = useState(note), [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(note);
  return <CaseModal title={t('Requirement note')} size="lg" busy={busy} dirty={dirty} onClose={onClose}><RequirementNotePane note={draft} dirty={dirty} canEdit={canEdit} onChange={setDraft} onSave={onSave} onBusy={setBusy} onUpload={onUpload} assetUrl={assetUrl}/></CaseModal>;
}
