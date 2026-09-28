"use client";

import { useId, useState, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { FileText, LayoutGrid, Plus, Table2 } from 'lucide-react';
import { Badge, Button, Checkbox, ControlledModalDialog, DataGrid, EmptyState, MenuButton, SelectField, SearchInput, TextInput, TextAreaField, NumericInput, useDesignSystem, type DataGridColumn } from '@/design-system';
import { blankEntry, briefFields, caseApi, caseRequest, entryPayload, formatCaseMoney, scopeLabel, type CaseBrief, type CaseContent, type CaseRoom, type ScopeEntry, type ItemDimension } from '@/lib/pre-project/content';
import { documentText, mediaIds, textDocument, type RequirementNote } from '@/lib/crm/note-document';
import { CaseModal } from './case-controls';
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
  const [deciding, setDeciding] = useState<{ entry: ScopeEntry; status: string } | null>(null);
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
  const rows = visible.filter(item => view === 'requirement' ? ['requirement', 'note'].includes(item.kind) : item.kind === view);
  const measurementRows: MeasurementRow[] = visible.filter(storedRequirement).flatMap(value => value.specification?.dimensions.length
    ? value.specification.dimensions.map(dimension => ({ id: `${value.id}:${dimension.id}`, entry: value, dimension }))
    : []);
  const cardEntries = view === 'measurements' ? visible.filter(storedRequirement) : rows;
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
      { id: 'scope', header: t('Scope'), size: 135, accessorFn: item => scopeLabel(t, item.scopeStatus), cell: ({ row: { original } }) => original.kind === 'requirement' ? <Badge tone={original.scopeStatus === 'included' ? 'success' : original.scopeStatus === 'undecided' ? 'warning' : 'neutral'}>{scopeLabel(t, original.scopeStatus)}</Badge> : <Badge tone="neutral">{t(original.kind === 'note' ? 'Note' : original.kind === 'file' ? 'Reference file' : 'Inspiration')}</Badge> },
      { id: 'measurements', header: t('Measurements'), size: 170, cell: ({ row: { original } }) => storedRequirement(original) ? <Button size="compact" variant="quiet" onPress={() => openSpecification(original, 'dimensions')}>{t(original.specification?.dimensions?.length ? 'View measurements' : canEditEntry(original) && !archived ? 'Add measurements' : 'Not entered')}</Button> : <span>—</span> },
    ] as DataGridColumn<ScopeEntry>[] : [
      { id: 'files', header: t('Files'), size: 180, cell: ({ row: { original } }) => <span className={styles.referenceCell}>{original.assets[0]?.hasPreview && <Image alt="" unoptimized width={40} height={40} src={assetUrl(original, original.assets[0], true)}/>}<span>{original.assets.length ? t(original.assets.length === 1 ? '{count} file' : '{count} files', { count: original.assets.length }) : t(original.referenceUrl ? 'Linked reference' : 'No attachment')}</span></span> },
      { id: 'source', header: t('Captured from'), size: 125, accessorFn: item => t(item.source === 'client' ? 'Client' : 'Team') },
    ] as DataGridColumn<ScopeEntry>[]),
    { id: 'action', header: '', size: 100, cell: ({ row: { original } }) => <Button size="compact" variant="quiet" aria-label={canEditEntry(original) && !archived ? t('Edit {title}', { title: original.title }) : t('View {title}', { title: original.title })} onPress={() => setEntry(original)}>{t(canEditEntry(original) && !archived ? 'Edit' : 'View')}</Button> },
  ];
  const captureActions = <div className={`${styles.toolbarActions} ${workspace.captureActions}`}>
        {!compact && <><Button size="compact" variant="quiet" onPress={() => setBriefOpen(true)}>{t('Project brief')}</Button><Button size="compact" variant="quiet" onPress={() => setRoomsOpen(true)}>{t('Manage rooms')}</Button></>}
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
    {view !== 'inspiration' && sharedNotes.failure && <p className={styles.error} role="alert">{sharedNotes.failure}<Button size="compact" variant="quiet" onPress={sharedNotes.refresh}>{t('Retry')}</Button></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={compact ? workspace.srOnly : styles.notice}>{message}</p>}
    {sharedNotes.loading && !allEntries.length && view !== 'inspiration' ? null : (view === 'requirement' || presentation === 'cards') ? <div className={workspace.cards}>{cardEntries.map(value => {
      return <article className={workspace.card} data-scope={value.kind === 'requirement' ? value.scopeStatus : undefined} key={value.id} aria-label={value.title}>
        <div className={workspace.body}>
          <div className={workspace.meta}><span>{data.rooms.find(r => r.id === value.roomId)?.name ?? value.roomName ?? ''}</span>{!compact && (value.kind === 'requirement' && canEditEntry(value) && !archived ? <MenuButton label={scopeLabel(t, value.scopeStatus)} items={[{id:'included',label:t('Include in scope')},{id:'excluded',label:t('Not included')},{id:'later',label:t('A later phase')},{id:'not_possible',label:t('Not possible')},{id:'undecided',label:t('Decide later')}]} onAction={key => {
            // Anything not included gets a reason the client can read; it's sealed with the accepted scope.
            if (['excluded','later','not_possible'].includes(String(key))) { setDeciding({ entry: value, status: String(key) }); return; }
            void saveEntry({...value,scopeStatus:String(key)}).catch(failure=>setError(failure instanceof Error?failure.message:t('Could not update scope.'))); }} /> : <span data-status={value.scopeStatus}>{value.kind === 'file' ? t('Site file') : value.kind === 'inspiration' ? t('Inspiration') : scopeLabel(t, value.scopeStatus)}</span>)}</div>
          <button className={workspace.title} aria-label={t('Open details for {title}', { title: value.title })} onClick={() => view === 'measurements' ? openSpecification(value, 'dimensions') : setEntry(value)}>{value.title}</button>
          {view === 'measurements' ? <div className={workspace.measurementPreview}>{value.specification?.dimensions.length ? <DimensionReadout dimensions={value.specification.dimensions.slice(0,2)} /> : <p className={workspace.note}>{t('No measurements yet.')}</p>}</div> : (value.document || value.note) && <NotePreview className={workspace.noteRich} document={value.document} limit={5} text={value.note} />}
          {value.assets.length > 0 && <div className={workspace.attachmentStrip} aria-label={t('{count} attachments', { count: value.assets.length })}>{value.assets.slice(0,3).map(asset => <button type="button" key={asset.id} title={asset.name} aria-label={t('View {name}', { name: asset.name })} onClick={() => setEntry(value)}>{asset.hasPreview ? <Image unoptimized src={assetUrl(value,asset,true)} alt="" width={28} height={28}/> : <FileText size={16}/>}<span>{asset.name}</span></button>)}{value.assets.length > 3 && <span className={workspace.moreAttachments}>+{value.assets.length-3}</span>}</div>}
          <div className={workspace.footer}>
            <Button size="compact" variant="quiet" aria-label={canEditEntry(value) && !archived ? (view === 'measurements' ? t('Edit measurements for {title}', { title: value.title }) : t('Edit {title}', { title: value.title })) : (view === 'measurements' ? t('View measurements for {title}', { title: value.title }) : t('View {title}', { title: value.title }))} onPress={() => view === 'measurements' ? openSpecification(value, 'dimensions') : setEntry(value)}>{canEditEntry(value) && !archived ? t(view === 'measurements' ? 'Edit sizes' : value.kind === 'file' ? 'Edit plan' : 'Edit note') : t(view === 'measurements' ? 'View sizes' : value.kind === 'file' ? 'View plan' : 'View note')} ↗</Button>
            {!compact && canEditEntry(value) && <MenuButton label={t('Actions')} items={[
              ...(!archived && value.kind === 'requirement' ? [{id:'specifications',label:t('Measurements')}] : []),
              ...(archived ? [] : [...data.rooms.filter(item=>item.id!==value.roomId).map(item=>({id:`room:${item.id}`,label:t('Move to {name}',{name:item.name})}))]),
              {id:archived?'restore':'archive',label:t(archived?'Restore':'Archive')},
            ]} onAction={key => { if(key === 'specifications'){openSpecification(value,'dimensions');return;} const changed = key.startsWith('room:') ? {...value,roomId:key.slice(5)} : value; void saveEntry(changed,key === 'archive' ? true : key === 'restore' ? false : undefined).then(()=>setMessage(t(key === 'archive' ? 'Archived. Find this item using the Archived filter.' : key === 'restore' ? 'Restored.' : 'Room updated.'))).catch(failure=>setError(failure instanceof Error?failure.message:t('Could not update this item.'))); }} />}
          </div>
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
    {deciding && <ScopeReason status={deciding.status} title={deciding.entry.title} initial={deciding.entry.scopeStatus === deciding.status ? deciding.entry.scopeNote ?? '' : ''} onClose={() => setDeciding(null)}
      onSave={async (reason) => { await saveEntry({ ...deciding.entry, scopeStatus: deciding.status, scopeNote: reason }); setDeciding(null); }} />}
    {roomsOpen && <RoomManager data={data} onClose={() => setRoomsOpen(false)} onSave={async value => { const saved = await caseRequest<CaseRoom>(workspaceId, caseId, 'rooms', 'PUT', { id: value.id, version: value.version, name: value.name, catalogRecordId: value.catalogRecordId ?? null }); setData(current => ({ ...current, rooms: [...current.rooms.filter(item => item.id !== saved.id), saved], entries: current.entries.map(item => item.roomId === saved.id ? { ...item, roomName: saved.name } : item) })); return saved; }}/>}
  </div>;
}

function BriefEditor({data,onClose,onSave}:{data:CaseContent;onClose:()=>void;onSave:(brief:CaseBrief)=>Promise<void>}) {
 const {locale}=useDesignSystem();const t=useT();
 const [draft,setDraft]=useState(data.brief);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const change=(key:string,value:string)=>setDraft(d=>({...d,[key]:value}));
 const field=(key:keyof typeof briefFields,large=false)=><div key={key} className={large?styles.full:undefined}>{large?<TextAreaField label={t(briefFields[key])} isDisabled={saving||!data.canEdit} value={draft[key]} maxLength={key==='goals'?6000:3000} onChange={value=>change(key,value)}/>:<TextInput label={t(briefFields[key])} isDisabled={saving||!data.canEdit} value={draft[key]} maxLength={key==='propertyType'?240:key==='area'?120:key==='timeline'||key==='budget'?500:key==='retainedItems'||key==='exclusions'?3000:1000} onChange={value=>change(key,value)}/>}</div>;
 return <CaseModal title={t("Project brief")} description={t("Confirm the context, budget and constraints before detailing each room.")} onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(data.brief)} busy={saving} footer={data.canEdit&&<Button type="submit" form="brief-form" variant="primary" isLoading={saving}>{t("Save brief")}</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<form id="brief-form" onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await onSave(draft);onClose();}catch(err){setError(err instanceof Error?err.message:t('Could not save.'));}finally{setSaving(false);}}}><fieldset disabled={saving||!data.canEdit}><div className={styles.grid}>{field('goals',true)}{field('propertyType')}{field('area')}{field('location')}{field('timeline')}
 <NumericInput label={t("Budget amount")} prefix={draft.currencyCode} isDisabled={saving||!data.canEdit} minValue={0} maxValue={1e12} formatOptions={{maximumFractionDigits:2}} value={draft.budgetAmount ? Number(draft.budgetAmount) : NaN} onChange={value=>change('budgetAmount',Number.isFinite(value)?String(value):'')}/>
 {field('budget')}{field('decisionMakers')}</div>
 <section className={styles.divider}><h3>{t('People, preferences & constraints')}</h3><div className={styles.grid}>{field('people',true)}{field('preferences',true)}{field('retainedItems')}{field('exclusions')}{field('constraints',true)}</div></section></fieldset></form>
 {data.crmContext.opportunityAmount&&<p className={styles.muted}>{t('CRM opportunity value: {amount}. This remains separate from the client’s budget.',{amount:formatCaseMoney(data.crmContext.opportunityAmount,data.crmContext.currencyCode??draft.currencyCode,locale,t)})}</p>}
 </CaseModal>;
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
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const heading = status === 'later' ? t("A later phase · {title}", { title }) : status === 'not_possible' ? t("Not possible · {title}", { title }) : t("Not included · {title}", { title });
  return <ControlledModalDialog isOpen size="md" title={heading} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} onPress={async () => { setBusy(true); setFailure(''); try { await onSave(reason.trim()); } catch (cause) { setFailure(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); } }}>{t("Save")}</Button></div>}>
    <TextAreaField label={t("Why (the client reads this)")} value={reason} onChange={setReason} autoFocus />
    {failure ? <p role="alert" className={styles.error}>{failure}</p> : null}
  </ControlledModalDialog>;
}
