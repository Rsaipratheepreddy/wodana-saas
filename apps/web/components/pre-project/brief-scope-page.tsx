"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { FileText, LayoutGrid, Plus, Table2 } from 'lucide-react';
import { Badge, Button, Checkbox, DataGrid, EmptyState, FormDialog, FormSection, InlineNotice, MenuButton, MoneyField, MoreDetails, SearchInput, SegmentedControl, SelectField, TextAreaField, TextInput, TypeChip, useDesignSystem, type DataGridColumn } from '@/design-system';
import { blankEntry, briefFields, caseApi, caseRequest, entryPayload, formatCaseMoney, scopeLabel, type CaseBrief, type CaseContent, type CaseRoom, type ScopeEntry, type ItemDimension } from '@/lib/pre-project/content';
import { documentText, mediaIds, textDocument, type RequirementNote } from '@/lib/crm/note-document';
import { useT } from '@/lib/i18n/i18n-provider';
import { ItemSpecificationEditor } from './item-specification-editor';
import { MeasurementCreateForm } from './measurement-create-form';
import { ScopeEditor } from './scope-entry-editor';
import { RoomManager } from './room-manager';
import { useRequirementNotes } from '../crm/requirement-notes';
import workspace from './requirements-workspace.module.css';
import { NotePreview } from '@/components/crm/note-preview';
import { DimensionReadout } from './scope-note-cards';
import tableStyles from '../crm/leads-page.module.css';
import styles from './case-content.module.css';
import { Skeleton } from "@/design-system";

type GatheringTab = 'requirement' | 'measurements' | 'file';
type MeasurementRow = { id: string; entry: ScopeEntry; dimension?: ItemDimension };

export function BriefScopePage({ initialData, view: initialView = 'requirement', readOnlyReason, compact = false }: { initialData: CaseContent; readOnlyReason?: string; view?: GatheringTab | 'inspiration'; compact?: boolean }) {
  const searchParams = useSearchParams();
  const t = useT();
  const [tab] = useState<GatheringTab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'measurements' ? 'measurements' : requested === 'site-plan' ? 'file' : initialView === 'inspiration' ? 'requirement' : initialView;
  });
  const view = initialView === 'inspiration' ? 'inspiration' : tab;
  const [presentation, setPresentation] = useState<'cards'|'table'>(view === 'measurements' ? 'table' : 'cards');
  const [specFocus, setSpecFocus] = useState<'dimensions'|undefined>();
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState('');
  const requestedRoom = searchParams.get('room');
  const [room, setRoom] = useState(() => requestedRoom && initialData.rooms.some(item => item.id === requestedRoom) ? requestedRoom : 'all');
  const [archived, setArchived] = useState(false);
  const [entry, setEntry] = useState<ScopeEntry|null>(null);
  const [specEntry, setSpecEntry] = useState<ScopeEntry|null>(null);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [measurementFor, setMeasurementFor] = useState<string>();
  const [measureAfterSave, setMeasureAfterSave] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState<{ entries: ScopeEntry[]; status: string } | null>(null);
  // Requirements are decided several at once: pick the cards, then one scope (and one reason) for all of them.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [scopeFilter, setScopeFilter] = useState<'all' | 'undecided' | 'included' | 'not_included'>('all');
  const [bulkBusy, setBulkBusy] = useState(false);
  const { locale } = useDesignSystem();
  const { workspaceId, caseId } = data;
  const blockedReason = readOnlyReason ?? t('Your role does not have permission to edit this record.');
  const sharedNotes = useRequirementNotes({ workspaceId, caseId }, initialView !== 'inspiration');

  const linkedNotes = new Map(sharedNotes.items.map(note => [note.scope?.id ?? `requirement-note:${note.id}`, note]));
  const noteEntry = (note: RequirementNote): ScopeEntry => {
    const scope = note.scope ? data.entries.find(item => item.id === note.scope!.id && item.version >= note.scope!.version) ?? note.scope : undefined;
    return {
      ...(scope ?? { ...blankEntry(), id: `requirement-note:${note.id}`, version: note.version, source: 'client', reviewStatus: 'captured' }),
      title: note.title, note: note.note, document: note.document, pinned: note.pinned,
      assets: note.assets ?? [], referenceUrl: note.links?.[0] ?? '',
      archivedAt: note.archived ? note.updatedAt || 'archived' : null,
    };
  };
  const allEntries = [...sharedNotes.items.map(noteEntry), ...data.entries.filter(item => !linkedNotes.has(item.id))];
  const canEditEntry = (value: ScopeEntry) => data.canEdit && (!linkedNotes.has(value.id) || sharedNotes.canEdit);
  const storedRequirement = (value: ScopeEntry) => value.kind === 'requirement' && !value.id.startsWith('requirement-note:');
  const openSpecification = (value: ScopeEntry, focus?: 'dimensions') => { setSpecFocus(focus); setSpecEntry(value); };
  const upsert = (saved: ScopeEntry) => setData(current => ({ ...current, entries: [saved, ...current.entries.filter(item => item.id !== saved.id)] }));
  const assetUrl = (value: ScopeEntry, asset: ScopeEntry['assets'][number], preview = false) => {
    const note = linkedNotes.get(value.id);
    return note ? sharedNotes.fileUrl(note.id, asset.id, preview) : caseApi(workspaceId, caseId, `assets/${asset.id}${preview ? '?preview=1' : ''}`);
  };
  const saveEntry = async (draft: ScopeEntry, archive?: boolean) => {
    if (!canEditEntry(draft)) throw new Error(t('This requirement is read only.'));
    const original = allEntries.find(item => item.id === draft.id);
    const document = draft.document && (documentText(draft.document.content) !== draft.note || [...mediaIds(draft.document.content)].some(id => !draft.assets.some(asset => asset.id === id))) ? textDocument(draft.note) : draft.document;
    const note = linkedNotes.get(draft.id);
    if (note) {
      const scope = {
        ...draft, id: note.scope?.id ?? note.id, version: note.scope ? draft.version : 0, kind: 'requirement' as const,
        assets: note.scope?.assets ?? [], document: textDocument(draft.note),
      };
      const savedNote = await sharedNotes.save({
        ...note, scope, title: draft.title, note: draft.note, document: document ?? undefined,
        assets: draft.assets, links: [...(draft.referenceUrl ? [draft.referenceUrl] : []), ...(note.links ?? []).slice(1)],
        archived: archive ?? Boolean(draft.archivedAt),
      });
      if (savedNote.scope) upsert(savedNote.scope);
      setMessage(t('Requirement saved.'));
      return noteEntry(savedNote);
    }
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, 'entries', 'PUT', { ...entryPayload({ ...draft, document }), archived: archive ?? Boolean(draft.archivedAt) });
    upsert(saved); setMessage(t(view === 'file' ? 'Site plan saved.' : 'Saved.')); return saved;
  };
  const visible = allEntries.filter(item => (archived ? Boolean(item.archivedAt) : !item.archivedAt)
    && (room === 'all' || item.roomId === room)
    && `${item.title} ${item.note} ${item.roomName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  // Moodboard pins and site photos have their own tabs; Requirements lists only what the client asked for.
  const inScopeFilter = (item: ScopeEntry) => scopeFilter === 'all' || (item.kind === 'requirement' && (scopeFilter === 'not_included'
    ? ['excluded', 'later', 'not_possible'].includes(item.scopeStatus) : item.scopeStatus === scopeFilter));
  const rows = visible.filter(item => (view === 'requirement' ? ['requirement', 'note'].includes(item.kind) : item.kind === view) && (view !== 'requirement' || inScopeFilter(item)));
  const requirementsShown = visible.filter(item => item.kind === 'requirement');
  const decidable = (item: ScopeEntry) => item.kind === 'requirement' && canEditEntry(item) && !archived && !compact;
  const picked = rows.filter(item => selected.has(item.id) && decidable(item));
  const toggle = (id: string, on: boolean) => setSelected(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  // One scope for every picked requirement; anything not included carries the same reason the client reads.
  const decideAll = async (entries: ScopeEntry[], status: string, reason?: string) => {
    setBulkBusy(true); setError('');
    let failed = 0;
    for (const item of entries) {
      try { await saveEntry({ ...item, scopeStatus: status, ...(reason !== undefined ? { scopeNote: reason } : {}) }); } catch { failed += 1; }
    }
    setBulkBusy(false);
    if (failed) setError(t('{count} could not be updated. Reload and try again.', { count: failed }));
    else { setSelected(new Set()); setMessage(entries.length === 1 ? t('Scope updated.') : t('{count} requirements updated.', { count: entries.length })); }
  };
  const chooseScope = (entries: ScopeEntry[], status: string) => {
    if (['excluded', 'later', 'not_possible'].includes(status)) { setDeciding({ entries, status }); return; }
    void decideAll(entries, status);
  };
  const measurementRows: MeasurementRow[] = visible.filter(storedRequirement).flatMap(value => value.specification?.dimensions.length
    ? value.specification.dimensions.map(dimension => ({ id: `${value.id}:${dimension.id}`, entry: value, dimension }))
    : []);
  const cardEntries = view === 'measurements' ? visible.filter(storedRequirement) : rows;
  // A link to one requirement (a quote's "decide" check) lands on its card, with its decision in focus.
  const requestedRequirement = view === 'requirement' ? searchParams.get('requirement') : null;
  const revealed = useRef(false);
  useEffect(() => {
    if (!requestedRequirement || revealed.current) return;
    const card = document.getElementById(`requirement-${requestedRequirement}`);
    if (!card) return;
    revealed.current = true;
    (card.querySelector<HTMLElement>('button') ?? card).focus({ preventScroll: true });
    card.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  });
  const measurementColumns: DataGridColumn<MeasurementRow>[] = [
    { id:'item',header:t('Item'),size:260,accessorFn:row=>row.entry.title,cell:({row:{original}})=><div className={workspace.rowSummary}><strong>{original.entry.title}</strong><span>{data.rooms.find(room=>room.id===original.entry.roomId)?.name??original.entry.roomName??''}</span></div> },
    { id:'dimension',header:t('Dimension'),size:150,accessorFn:row=>row.dimension?.name??'' },
    { id:'measured',header:t('Measured size'),size:150,accessorFn:row=>row.dimension?.measured!=null?`${row.dimension.measured} ${row.dimension.unit}`:t('Not measured') },
    { id:'action',header:'',size:90,cell:({row:{original}})=><Button size="compact" variant="quiet" aria-label={!canEditEntry(original.entry)||archived?t('View measurements for {title}',{title:original.entry.title}):t('Edit measurements for {title}',{title:original.entry.title})} onPress={()=>openSpecification(original.entry,'dimensions')}>{t(!canEditEntry(original.entry)||archived?'View':'Edit')}</Button> },
  ];
  const columns: DataGridColumn<ScopeEntry>[] = [
    { accessorKey: 'title', header: t(view === 'file' ? 'Site plan' : view === 'inspiration' ? 'Inspiration' : 'Requirement'), size: 320, cell: ({ row: { original } }) => <div className={workspace.rowSummary}><strong>{original.title}</strong>{original.note && <span>{original.note}</span>}</div> },
    { id: 'roomName', header: t('Room'), size: 155, accessorFn: item => data.rooms.find(value => value.id === item.roomId)?.name ?? item.roomName ?? '' },
    ...(view === 'requirement' ? [
      { id: 'quantity', header: t('Quantity'), size: 115, accessorFn: item => item.quantity != null ? `${item.quantity} ${item.unit}` : '—' },
      { id: 'scope', header: t('Scope'), size: 135, accessorFn: item => scopeLabel(t, item.scopeStatus), cell: ({ row: { original } }) => original.kind === 'requirement' ? <Badge tone={original.scopeStatus === 'included' ? 'success' : original.scopeStatus === 'undecided' ? 'warning' : 'neutral'}>{scopeLabel(t, original.scopeStatus)}</Badge> : <Badge hue={original.kind === 'note' ? 6 : original.kind === 'file' ? 1 : 2}>{t(original.kind === 'note' ? 'Note' : original.kind === 'file' ? 'Reference file' : 'Inspiration')}</Badge> },
      { id: 'measurements', header: t('Measurements'), size: 170, cell: ({ row: { original } }) => storedRequirement(original) ? <Button size="compact" variant="quiet" onPress={() => openSpecification(original, 'dimensions')}>{t(original.specification?.dimensions?.length ? 'View measurements' : canEditEntry(original) && !archived ? 'Add measurements' : 'Not entered')}</Button> : <span>—</span> },
    ] as DataGridColumn<ScopeEntry>[] : [
      { id: 'files', header: t('Files'), size: 180, cell: ({ row: { original } }) => <span className={styles.referenceCell}>{original.assets[0]?.hasPreview && <Image alt="" unoptimized width={40} height={40} src={assetUrl(original, original.assets[0], true)}/>}<span>{original.assets.length ? t(original.assets.length === 1 ? '{count} file' : '{count} files', { count: original.assets.length }) : t(original.referenceUrl ? 'Linked reference' : 'No attachment')}</span></span> },
      { id: 'source', header: t('Captured from'), size: 125, accessorFn: item => t(item.source === 'client' ? 'Client' : 'Team') },
    ] as DataGridColumn<ScopeEntry>[]),
    { id: 'action', header: '', size: 100, cell: ({ row: { original } }) => <Button size="compact" variant="quiet" aria-label={canEditEntry(original) && !archived ? t('Edit {title}', { title: original.title }) : t('View {title}', { title: original.title })} onPress={() => setEntry(original)}>{t(canEditEntry(original) && !archived ? 'Edit' : 'View')}</Button> },
  ];
  const captureActions = <div className={`${styles.toolbarActions} ${workspace.captureActions}`}>
        {/* Someone who can't edit the case reads the brief (it opens read-only); managing the rooms is an edit, so it isn't offered. */}
        {!compact && <><Button size="compact" variant="quiet" onPress={() => setBriefOpen(true)}>{t('Project brief')}</Button>{data.canEdit ? <Button size="compact" variant="quiet" onPress={() => setRoomsOpen(true)}>{t('Manage rooms')}</Button> : null}</>}
        {view !== 'requirement' && view !== 'measurements' && <div className={styles.presentationSwitch} role="group" aria-label={t('Display')}><button type="button" aria-label={t('Cards view')} aria-pressed={presentation === 'cards'} onClick={() => setPresentation('cards')}><LayoutGrid size={15}/></button><button type="button" aria-label={t('Table view')} aria-pressed={presentation === 'table'} onClick={() => setPresentation('table')}><Table2 size={15}/></button></div>}
        {view === 'measurements' && <EligibilityButton reason={blockedReason} isDisabled={!data.canEdit} size="compact" variant="primary" onPress={() => { setArchived(false); setMeasurementFor(undefined); setMeasurementOpen(true); }}><Plus size={14}/>{t('Add measurement')}</EligibilityButton>}
        {view !== 'measurements' && <EligibilityButton reason={blockedReason} isDisabled={!data.canEdit} size="compact" variant="primary" onPress={() => { setArchived(false); setEntry({ ...blankEntry(room === 'all' ? null : room), kind: view }); }}><Plus size={14}/>{t(view === 'file' ? 'Add site plan' : view === 'inspiration' ? 'Add inspiration' : 'Add requirement')}</EligibilityButton>}
      </div>;
  const panel = <div className={styles.registerPanel}>
    <div className={`${styles.compactToolbar} ${workspace.toolbar}`}>
      <SearchInput label={t(view === 'measurements' ? 'Search measurements' : view === 'file' ? 'Search site plans' : view === 'inspiration' ? 'Search inspirations' : 'Search requirements')} value={search} onChange={setSearch} placeholder={t(view === 'measurements' ? 'Search measurements…' : view === 'file' ? 'Search site plans…' : view === 'inspiration' ? 'Search inspiration…' : 'Search requirements…')}/>
      <div className={workspace.roomFilter}><SelectField label={t('Room')} selectedKey={compact && archived ? 'archived' : room} onSelectionChange={key => { if (compact) { setArchived(key === 'archived'); setRoom(key === 'archived' ? 'all' : String(key ?? 'all')); } else setRoom(String(key ?? 'all')); }} items={[{id:'all',label:t('All rooms')},...data.rooms.map(value => ({id:value.id,label:value.name})),...(compact ? [{id:'archived',label:t('Archived requirements')}] : [])]}/></div>
      {!compact && <Checkbox isSelected={archived} onChange={setArchived}>{t('Archived')}</Checkbox>}
      {captureActions}
    </div>
    {view !== 'inspiration' && sharedNotes.loading && <Skeleton lines={4} />}
    {view !== 'inspiration' && sharedNotes.failure && <InlineNotice tone="error" message={sharedNotes.failure} action={<Button size="compact" variant="quiet" onPress={sharedNotes.refresh}>{t('Retry')}</Button>} />}
    {view === 'requirement' && requirementsShown.length ? <div className={workspace.scopeBar}>
      <SegmentedControl label={t('Scope')} value={scopeFilter} onChange={value => { setScopeFilter(value as typeof scopeFilter); setSelected(new Set()); }} options={[
        { id: 'all', label: t('All'), count: requirementsShown.length },
        { id: 'undecided', label: scopeLabel(t, 'undecided'), count: requirementsShown.filter(item => item.scopeStatus === 'undecided').length },
        { id: 'included', label: t('Included'), count: requirementsShown.filter(item => item.scopeStatus === 'included').length },
        { id: 'not_included', label: t('Not included'), count: requirementsShown.filter(item => ['excluded', 'later', 'not_possible'].includes(item.scopeStatus)).length },
      ]} />
      {picked.length ? <div className={workspace.bulkBar} role="group" aria-label={t('Decide the selected requirements')}>
        <Badge tone="info">{t('{count} selected', { count: picked.length })}</Badge>
        <Button size="compact" variant="primary" isDisabled={bulkBusy} onPress={() => chooseScope(picked, 'included')}>{t('Include in scope')}</Button>
        <MenuButton size="compact" label={t('Not included')} items={[{ id: 'excluded', label: t('Not included') }, { id: 'later', label: t('Later phase') }, { id: 'not_possible', label: t('Not possible') }, { id: 'undecided', label: scopeLabel(t, 'undecided') }]}
          onAction={key => chooseScope(picked, String(key))} />
        <Button size="compact" variant="quiet" isDisabled={bulkBusy} onPress={() => setSelected(new Set())}>{t('Clear')}</Button>
      </div> : rows.some(decidable) ? <Button size="compact" variant="quiet" onPress={() => setSelected(new Set(rows.filter(decidable).map(item => item.id)))}>{t('Select all shown')}</Button> : null}
    </div> : null}
    {error && <InlineNotice tone="error" message={error} />}{message && <p role="status" className={compact ? workspace.srOnly : styles.notice}>{message}</p>}
    {sharedNotes.loading && !allEntries.length && view !== 'inspiration' ? null : (view === 'requirement' || presentation === 'cards') ? <div className={workspace.cards}>{cardEntries.map(value => {
      return <article className={workspace.card} data-scope={value.kind === 'requirement' ? value.scopeStatus : undefined} data-picked={selected.has(value.id) || undefined} key={value.id} id={value.kind === 'requirement' ? `requirement-${value.id}` : undefined} aria-label={value.title}>
        <div className={workspace.body}>
          <div className={workspace.meta}>{decidable(value) ? <Checkbox aria-label={t('Select {title}', { title: value.title })} isSelected={selected.has(value.id)} onChange={on => toggle(value.id, on)} /> : null}{(() => { const room = data.rooms.find(r => r.id === value.roomId)?.name ?? value.roomName ?? ''; return room ? <span className={workspace.room}>{room}</span> : <i aria-hidden="true" />; })()}{!compact && (value.kind === 'requirement' && canEditEntry(value) && !archived ? <MenuButton label={scopeLabel(t, value.scopeStatus)} items={[{id:'included',label:t('Include in scope')},{id:'excluded',label:t('Not included')},{id:'later',label:t('A later phase')},{id:'not_possible',label:t('Not possible')},{id:'undecided',label:t('Decide later')}]} onAction={key => {
            // Anything not included gets a reason the client can read; it's sealed with the accepted scope.
            chooseScope([value], String(key)); }} /> : value.kind === 'file' ? <TypeChip>{t('Site file')}</TypeChip> : value.kind === 'inspiration' ? <TypeChip>{t('Inspiration')}</TypeChip>
            : <Badge tone={value.scopeStatus === 'included' ? 'success' : value.scopeStatus === 'excluded' ? 'danger' : value.scopeStatus === 'undecided' ? 'warning' : 'neutral'}>{scopeLabel(t, value.scopeStatus)}</Badge>)}</div>
          <button type="button" className={workspace.title} aria-label={t('Open details for {title}', { title: value.title })} onClick={() => view === 'measurements' ? openSpecification(value, 'dimensions') : setEntry(value)}>{value.title}</button>
          {view === 'measurements' ? <div className={workspace.measurementPreview}>{value.specification?.dimensions.length ? <DimensionReadout dimensions={value.specification.dimensions.slice(0,2)} /> : <p className={workspace.note}>{t('No measurements yet.')}</p>}</div> : (value.document || value.note) && <NotePreview className={workspace.noteRich} document={value.document} limit={5} text={value.note} />}
          {value.assets.length > 0 && <div className={workspace.attachmentStrip} aria-label={t('{count} attachments', { count: value.assets.length })}>{value.assets.slice(0,3).map(asset => <button type="button" key={asset.id} title={asset.name} aria-label={t('View {name}', { name: asset.name })} onClick={() => setEntry(value)}>{asset.hasPreview ? <Image unoptimized src={assetUrl(value,asset,true)} alt="" width={28} height={28}/> : <FileText size={16}/>}<span>{asset.name}</span></button>)}{value.assets.length > 3 && <span className={workspace.moreAttachments}>+{value.assets.length-3}</span>}</div>}
          {/* The title opens the item; edit, measurements, moving and archiving sit in one Actions menu (no bare link in a footer). */}
          {!compact && canEditEntry(value) ? <div className={workspace.footer}>
            <MenuButton label={t('Actions')} items={[
              ...(!archived ? [{id:'edit',label:t(view === 'measurements' ? 'Edit sizes' : value.kind === 'file' ? 'Edit plan' : 'Edit note')}] : []),
              ...(!archived && value.kind === 'requirement' ? [{id:'specifications',label:t('Measurements')}] : []),
              ...(archived ? [] : [...data.rooms.filter(item=>item.id!==value.roomId).map(item=>({id:`room:${item.id}`,label:t('Move to {name}',{name:item.name})}))]),
              {id:archived?'restore':'archive',label:t(archived?'Restore':'Archive')},
            ]} onAction={key => { if(key === 'edit'){ if (view === 'measurements') openSpecification(value, 'dimensions'); else setEntry(value); return; } if(key === 'specifications'){openSpecification(value,'dimensions');return;} const changed = key.startsWith('room:') ? {...value,roomId:key.slice(5)} : value; void saveEntry(changed,key === 'archive' ? true : key === 'restore' ? false : undefined).then(()=>setMessage(t(key === 'archive' ? 'Archived. Find this item using the Archived filter.' : key === 'restore' ? 'Restored.' : 'Room updated.'))).catch(failure=>setError(failure instanceof Error?failure.message:t('Could not update this item.'))); }} />
          </div> : null}
        </div>
      </article>;
    })}{!cardEntries.length && <div className={workspace.emptyFrame}><EmptyState illustration={archived || search || room !== "all" ? "search" : view === "file" ? "upload" : "empty"} title={t(archived ? "No archived items" : search || room !== "all" ? "Nothing matches these filters" : view === "file" ? "No site plans yet" : view === "inspiration" ? "No inspiration yet" : "No requirements yet")} description={t(archived || search || room !== "all" ? "Try another room or clear the search." : view === "file" ? "Add a floor plan, survey or site drawing." : view === "inspiration" ? "Collect photos, links and ideas the client likes." : "Add a note to capture what the client needs.")} /></div>}</div> : <div className={tableStyles.recordTablePanel}>{view === 'measurements'
      ? <DataGrid key="measurements" ariaLabel={t('Measurements')} data={measurementRows} columns={measurementColumns} getRowId={item => item.id} onRowAction={item => openSpecification(item.entry, 'dimensions')} showToolbar={false} selectable={false} pageSize={25} emptyTitle={t('No measurements yet')} emptyDescription={t('Choose an item or type a name, then add its measurements.')}/>
      : <DataGrid key={view} ariaLabel={t(view === 'file' ? 'Site plans' : view === 'inspiration' ? 'Client inspirations' : 'Requirements')} data={rows} columns={columns} getRowId={item => item.id} onRowAction={setEntry} showToolbar={false} selectable={false} pageSize={25} emptyTitle={t(view === 'file' ? 'No site plans yet' : view === 'inspiration' ? 'No inspiration yet' : 'No requirements yet')} emptyDescription={t(view === 'file' ? 'Upload site plans, drawings and layout references.' : 'Choose a room and add a requirement.')}/>}</div>}
  </div>;
  const editingNote = entry ? linkedNotes.get(entry.id) : undefined;
  return <div className={`${styles.content} ${compact ? workspace.compact : ''}`}>
    <div className={workspace.workspace}>
      <div className={workspace.main}>
        {!compact && <h2 className={workspace.visuallyHidden}>{t(view === 'requirement' ? 'Requirements' : view === 'measurements' ? 'Measurements' : view === 'file' ? 'Site plans' : 'Inspiration')}</h2>}
        {!data.canEdit && <p className={workspace.readOnly} role="note">{blockedReason}</p>}
        {panel}
      </div>
    </div>
    {entry && <ScopeEditor key={entry.id} entry={entry} data={{ ...data, canEdit: canEditEntry(entry) }} assetUrl={(asset, preview) => assetUrl(entry, asset, preview)} uploadFile={editingNote ? (file, id) => sharedNotes.upload(editingNote.id, file, id) : undefined} onClose={() => { setEntry(null); setMeasureAfterSave(false); }} onSpecifications={() => { openSpecification(entry); setEntry(null); }} onSave={async draft => { const saved = await saveEntry(draft); if (measureAfterSave) { setEntry(null); setMeasureAfterSave(false); setMeasurementFor(saved.id); setMeasurementOpen(true); } return saved; }} onArchive={async value => { await saveEntry(entry, value); setEntry(null); setMessage(t(value ? 'Archived.' : 'Restored.')); }}/>}
    {measurementOpen && <MeasurementCreateForm data={data} entries={allEntries.filter(value => storedRequirement(value) && !value.archivedAt && canEditEntry(value))} initialEntryId={measurementFor} initialRoom={room} onClose={() => setMeasurementOpen(false)} onCreateRequirement={() => { setMeasurementOpen(false); setMeasureAfterSave(true); setEntry(blankEntry(room === 'all' ? null : room)); }} onSaved={(value, specification) => { upsert({ ...value, assets: data.entries.find(item => item.id === value.id)?.assets ?? value.assets, specification }); setSearch(''); setRoom(value.roomId ?? 'all'); setMessage(t('Measurement saved.')); setMeasurementOpen(false); }}/>} 
    {specEntry && <ItemSpecificationEditor entry={specEntry} data={{ ...data, canEdit: canEditEntry(specEntry) }} focusSection={specFocus} onClose={() => setSpecEntry(null)} onSaved={specification => { upsert({ ...specEntry, assets: data.entries.find(item => item.id === specEntry.id)?.assets ?? specEntry.assets, specification }); setSpecEntry(null); setMessage(t('Measurements saved.')); }}/>}
    {briefOpen && <BriefEditor data={data} onClose={() => setBriefOpen(false)} onSave={async brief => { const input = { ...brief }; delete input.updatedAt; const saved = await caseRequest<CaseBrief>(workspaceId, caseId, 'brief', 'PUT', input); setData(current => ({ ...current, brief: saved, fromCrm: false })); setMessage(t('Brief saved.')); }}/>}
    {deciding && <ScopeReason status={deciding.status} title={deciding.entries.length === 1 ? deciding.entries[0].title : t('{count} requirements', { count: deciding.entries.length })}
      initial={deciding.entries.length === 1 && deciding.entries[0].scopeStatus === deciding.status ? deciding.entries[0].scopeNote ?? '' : ''} onClose={() => setDeciding(null)}
      onSave={async (reason) => { await decideAll(deciding.entries, deciding.status, reason); setDeciding(null); }} />}
    {roomsOpen && data.canEdit && <RoomManager data={data} onClose={() => setRoomsOpen(false)} onSave={async value => { const saved = await caseRequest<CaseRoom>(workspaceId, caseId, 'rooms', 'PUT', { id: value.id, version: value.version, name: value.name, catalogRecordId: value.catalogRecordId ?? null }); setData(current => ({ ...current, rooms: [...current.rooms.filter(item => item.id !== saved.id), saved], entries: current.entries.map(item => item.roomId === saved.id ? { ...item, roomName: saved.name } : item) })); return saved; }}/>}
  </div>;
}

function BriefEditor({data,onClose,onSave}:{data:CaseContent;onClose:()=>void;onSave:(brief:CaseBrief)=>Promise<void>}) {
 const {locale}=useDesignSystem();const t=useT();
 const [draft,setDraft]=useState(data.brief);const change=(key:string,value:string)=>setDraft(d=>({...d,[key]:value}));
 const readOnly=!data.canEdit;
 const limit=(key:keyof typeof briefFields)=>key==='goals'?6000:key==='propertyType'?240:key==='area'?120:key==='timeline'||key==='budget'?500:key==='retainedItems'||key==='exclusions'?3000:1000;
 const field=(key:keyof typeof briefFields,large=false)=>large
  ?<TextAreaField key={key} label={t(briefFields[key])} isReadOnly={readOnly} value={draft[key]} maxLength={limit(key)} onChange={value=>change(key,value)}/>
  :<TextInput key={key} label={t(briefFields[key])} isReadOnly={readOnly} value={draft[key]} maxLength={limit(key)} onChange={value=>change(key,value)}/>;
 const later=['people','preferences','retainedItems','exclusions','constraints'] as const;
 return <FormDialog title={t("Project brief")} onClose={onClose} isDirty={JSON.stringify(draft)!==JSON.stringify(data.brief)} hideSubmit={readOnly} cancelLabel={readOnly?t('Close'):undefined}
  submitLabel={t("Save brief")} closeOnSuccess onSubmit={()=>onSave(draft)}>
  <FormSection>
   {field('goals',true)}
   {field('decisionMakers')}
  </FormSection>
  <FormSection title={t("Property")}>
   {field('propertyType')}{field('area')}{field('location')}
  </FormSection>
  <FormSection title={t("Budget and timeline")}>
   <MoneyField label={t("Budget amount")} currency={draft.currencyCode} isReadOnly={readOnly} value={draft.budgetAmount ?? ''} onChange={value=>change('budgetAmount',value)}/>
   {field('budget')}
   {data.crmContext.opportunityAmount?<p className={styles.muted}>{t('CRM opportunity value: {amount}. This remains separate from the client’s budget.',{amount:formatCaseMoney(data.crmContext.opportunityAmount,data.crmContext.currencyCode??draft.currencyCode,locale,t)})}</p>:null}
   {field('timeline')}
  </FormSection>
  <MoreDetails label={t('People, preferences & constraints')} filled={later.filter(key=>draft[key]?.trim()).length}>
   {field('people',true)}{field('preferences',true)}
   {field('retainedItems')}{field('exclusions')}
   {field('constraints',true)}
  </MoreDetails>
 </FormDialog>;
}

function EligibilityButton({ reason, ...props }: ComponentProps<typeof Button> & { reason: string }) {
  const id = useId();
  return <span className={workspace.blockedAction} tabIndex={props.isDisabled ? 0 : undefined} aria-label={props.isDisabled ? reason : undefined} aria-describedby={props.isDisabled ? id : undefined}>
    <Button {...props} />
    {props.isDisabled && <span id={id} role="tooltip" className={workspace.blockedTip}>{reason}</span>}
  </span>;
}

/** Why a requirement isn't in this quotation, in words the client reads; it's sealed with the accepted scope. */
function ScopeReason({ status, title, initial, onClose, onSave }: { status: string; title: string; initial: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState(initial);
  const heading = status === 'later' ? t("A later phase · {title}", { title }) : status === 'not_possible' ? t("Not possible · {title}", { title }) : t("Not included · {title}", { title });
  return <FormDialog size="md" title={heading} onClose={onClose} isDirty={reason.trim() !== initial.trim()} submitLabel={t("Save")} onSubmit={() => onSave(reason.trim())}>
    <TextAreaField label={t("Why (the client reads this)")} value={reason} onChange={setReason} />
  </FormDialog>;
}
