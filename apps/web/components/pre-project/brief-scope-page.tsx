"use client";

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { ClipboardList, DoorOpen, FileText, LayoutGrid, Plus, Ruler, Table2 } from 'lucide-react';
import { Button, Checkbox, DataGrid, SelectField, SearchInput, useDesignSystem, type DataGridColumn } from '@/design-system';
import { blankEntry, briefFields, caseApi, caseRequest, deriveDiscoveryCoverage, entryPayload, formatCaseMoney, parseScopePaste, scopeLabels, type CaseBrief, type CaseContent, type CaseRoom, type ScopeEntry, type ItemDimension } from '@/lib/pre-project/content';
import { mediaIds, textDocument, type RequirementNote } from '@/lib/crm/note-document';
import { CaseModal, CatalogChoiceField } from './case-controls';
import { ItemSpecificationEditor } from './item-specification-editor';
import { MeasurementCreateForm } from './measurement-create-form';
import { ScopeEditor } from './scope-entry-editor';
import { useRequirementNotes } from '../crm/requirement-notes';
import { ScopeNoteCards } from './scope-note-cards';
import tableStyles from '../crm/leads-page.module.css';
import styles from './case-content.module.css';

type GatheringTab = 'requirement' | 'measurements' | 'file';
type MeasurementRow = { id: string; entry: ScopeEntry; dimension?: ItemDimension };
const gatheringTabs = [
  { id: 'requirement', label: 'Requirements', icon: ClipboardList },
  { id: 'measurements', label: 'Measurements', icon: Ruler },
  { id: 'file', label: 'Site plan', icon: FileText },
] as const;

export function BriefScopePage({ initialData, view: initialView = 'requirement' }: { initialData: CaseContent; view?: GatheringTab | 'inspiration' }) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<GatheringTab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'measurements' ? 'measurements' : requested === 'site-plan' ? 'file' : initialView === 'inspiration' ? 'requirement' : initialView;
  });
  const view = initialView === 'inspiration' ? 'inspiration' : tab;
  const [presentation, setPresentation] = useState<'cards'|'table'>('cards');
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
  const [bulk, setBulk] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { locale } = useDesignSystem();
  const { workspaceId, caseId } = data;
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
  // Older production responses predate discovery coverage. Derive it safely so
  // existing cases still open while the API and web releases are rolling out.
  const coverage = deriveDiscoveryCoverage(data.rooms, allEntries, data.coverage?.verifiedMeasurementItemIds ?? []);
  const canEditEntry = (value: ScopeEntry) => data.canEdit && (!linkedNotes.has(value.id) || sharedNotes.canEdit);
  const storedRequirement = (value: ScopeEntry) => value.kind === 'requirement' && !value.id.startsWith('requirement-note:');
  const openSpecification = (value: ScopeEntry, focus?: 'dimensions') => { setSpecFocus(focus); setSpecEntry(value); };
  const upsert = (saved: ScopeEntry) => setData(current => ({ ...current, entries: [saved, ...current.entries.filter(item => item.id !== saved.id)] }));
  const assetUrl = (value: ScopeEntry, asset: ScopeEntry['assets'][number], preview = false) => {
    const note = linkedNotes.get(value.id);
    return note ? sharedNotes.fileUrl(note.id, asset.id, preview) : caseApi(workspaceId, caseId, `assets/${asset.id}${preview ? '?preview=1' : ''}`);
  };
  const saveEntry = async (draft: ScopeEntry, archive?: boolean) => {
    if (!canEditEntry(draft)) throw new Error('This requirement is read only.');
    const original = allEntries.find(item => item.id === draft.id);
    const document = draft.document && (draft.note !== original?.note || [...mediaIds(draft.document.content)].some(id => !draft.assets.some(asset => asset.id === id))) ? textDocument(draft.note) : draft.document;
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
      setMessage('Requirement saved.');
      return noteEntry(savedNote);
    }
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, 'entries', 'PUT', { ...entryPayload({ ...draft, document }), archived: archive ?? Boolean(draft.archivedAt) });
    upsert(saved); setMessage(view === 'file' ? 'Site plan saved.' : 'Saved.'); return saved;
  };
  const visible = allEntries.filter(item => (archived ? Boolean(item.archivedAt) : !item.archivedAt)
    && (room === 'all' || (item.roomId ?? 'general') === room)
    && `${item.title} ${item.note} ${item.roomName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const rows = visible.filter(item => view === 'requirement' ? ['requirement', 'note'].includes(item.kind) : item.kind === view);
  const measurementRows: MeasurementRow[] = visible.filter(storedRequirement).flatMap(value => value.specification?.dimensions.length
    ? value.specification.dimensions.map(dimension => ({ id: `${value.id}:${dimension.id}`, entry: value, dimension }))
    : [{ id: value.id, entry: value }]);
  const cardEntries = view === 'measurements' ? visible.filter(storedRequirement) : rows;
  const measurementColumns: DataGridColumn<MeasurementRow>[] = [
    { id: 'item', header: 'Requirement', size: 240, accessorFn: row => row.entry.title },
    { id: 'room', header: 'Room', size: 150, accessorFn: row => row.entry.roomName ?? 'Whole project' },
    { id: 'dimension', header: 'Dimension', size: 145, accessorFn: row => row.dimension?.name ?? 'Not entered' },
    { id: 'approximate', header: 'Approximate', size: 125, accessorFn: row => row.dimension?.approximate != null ? `${row.dimension.approximate} ${row.dimension.unit}` : '—' },
    { id: 'measured', header: 'Measured', size: 125, accessorFn: row => row.dimension?.measured != null ? `${row.dimension.measured} ${row.dimension.unit}` : '—' },
    { id: 'source', header: 'Source', size: 150, accessorFn: row => row.dimension ? `${row.dimension.source === 'client' ? 'Client' : 'Team'} · ${row.dimension.verification ?? 'unverified'}` : '—' },
    { id: 'action', header: '', size: 160, cell: ({ row: { original } }) => <Button size="compact" variant="quiet" onPress={() => openSpecification(original.entry, 'dimensions')}>{!data.canEdit || archived ? 'View measurements' : original.dimension ? 'Edit measurements' : 'Add measurements'}</Button> },
  ];
  const columns: DataGridColumn<ScopeEntry>[] = [
    { accessorKey: 'title', header: view === 'file' ? 'Site plan' : view === 'inspiration' ? 'Inspiration' : 'Requirement', size: 280, cell: ({ row: { original } }) => <strong>{original.title}</strong> },
    { id: 'roomName', header: 'Room', size: 155, accessorFn: item => data.rooms.find(value => value.id === item.roomId)?.name ?? item.roomName ?? 'Whole project' },
    ...(view === 'requirement' ? [
      { id: 'quantity', header: 'Quantity', size: 115, accessorFn: item => item.quantity != null ? `${item.quantity} ${item.unit}` : '—' },
      { id: 'scope', header: 'Scope', size: 115, accessorFn: item => scopeLabels[item.scopeStatus] ?? item.scopeStatus },
    ] as DataGridColumn<ScopeEntry>[] : [
      { id: 'files', header: 'Files', size: 180, cell: ({ row: { original } }) => <span className={styles.referenceCell}>{original.assets[0]?.hasPreview && <Image alt="" unoptimized width={40} height={40} src={assetUrl(original, original.assets[0], true)}/>}<span>{original.assets.length ? `${original.assets.length} file${original.assets.length === 1 ? '' : 's'}` : original.referenceUrl ? 'Linked reference' : 'No attachment'}</span></span> },
      { id: 'source', header: 'Captured from', size: 125, accessorFn: item => item.source === 'client' ? 'Client' : 'Team' },
    ] as DataGridColumn<ScopeEntry>[]),
    { accessorKey: 'note', header: 'Notes', size: 300 },
    { id: 'action', header: '', size: 100, cell: ({ row: { original } }) => <Button size="compact" variant="quiet" aria-label={`${canEditEntry(original) && !archived ? 'Edit' : 'View'} ${original.title}`} onPress={() => setEntry(original)}>{canEditEntry(original) && !archived ? 'Edit' : 'View'}</Button> },
  ];
  const changeTab = (key: string | number) => {
    const next = key as GatheringTab;
    setTab(next); setSearch(''); setError(''); setMessage('');
    const url = new URL(window.location.href);
    if (next === 'requirement') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next === 'file' ? 'site-plan' : next);
    window.history.replaceState(window.history.state, '', url);
  };
  const panel = <div className={styles.registerPanel}>
    <div className={styles.compactToolbar}>
      <SearchInput label={view === 'measurements' ? 'Search measurements' : view === 'file' ? 'Search site plans' : view === 'inspiration' ? 'Search inspirations' : 'Search requirements'} value={search} onChange={setSearch} placeholder={view === 'file' ? 'Search site plans…' : 'Search requirements or rooms…'}/>
      <div className={styles.compactFilter}><SelectField label="Room" selectedKey={room} onSelectionChange={key => key && setRoom(String(key))} items={[{ id: 'all', label: 'All rooms' }, { id: 'general', label: 'Whole project' }, ...data.rooms.map(item => ({ id: item.id, label: item.name }))]}/></div>
      <Checkbox isSelected={archived} onChange={setArchived}>Archived</Checkbox>
      <div className={styles.toolbarActions}>
        <div className={styles.presentationSwitch} role="group" aria-label="Display"><button type="button" aria-label="Cards view" aria-pressed={presentation === 'cards'} onClick={() => setPresentation('cards')}><LayoutGrid size={15}/></button><button type="button" aria-label="Table view" aria-pressed={presentation === 'table'} onClick={() => setPresentation('table')}><Table2 size={15}/></button></div>
        {data.canEdit && view === 'measurements' && <Button size="compact" variant="primary" onPress={() => { setArchived(false); setMeasurementFor(undefined); setMeasurementOpen(true); }}><Plus size={14}/>Add measurement</Button>}
        {data.canEdit && view === 'requirement' && <Button size="compact" onPress={() => setBulk(true)}>Paste rows</Button>}
        {data.canEdit && view !== 'measurements' && <Button size="compact" variant="primary" onPress={() => { setArchived(false); setEntry({ ...blankEntry(room === 'all' || room === 'general' ? null : room), kind: view }); }}><Plus size={14}/>{view === 'file' ? 'Add site plan' : view === 'inspiration' ? 'Add inspiration' : 'Add requirement'}</Button>}
      </div>
    </div>
    {view !== 'inspiration' && sharedNotes.loading && <p role="status" className={styles.muted}>Loading requirements…</p>}
    {view !== 'inspiration' && sharedNotes.failure && <p className={styles.error} role="alert">{sharedNotes.failure}<Button size="compact" variant="quiet" onPress={sharedNotes.refresh}>Retry</Button></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={styles.notice}>{message}</p>}
    {presentation === 'cards' ? <ScopeNoteCards key={`${view}:${room}:${search}:${archived}`} entries={cardEntries} workspaceId={workspaceId} caseId={caseId} locale={locale} measurements={view === 'measurements'} assetUrl={assetUrl} canEdit={data.canEdit} canSpecify={storedRequirement} emptyTitle={view === 'file' ? 'No site plans yet' : view === 'inspiration' ? 'No inspiration yet' : view === 'measurements' ? 'No measurements yet' : 'No requirements yet'} emptyDescription={view === 'file' ? 'Add a site plan, drawing or layout reference.' : view === 'measurements' ? 'Use Add measurement to record a site size.' : 'Add a requirement, photo or reference.'} onOpen={setEntry} onSpecifications={openSpecification}/> : <div className={tableStyles.tableRegion}>{view === 'measurements'
      ? <DataGrid key="measurements" appearance="flush" ariaLabel="Measurements" data={measurementRows} columns={measurementColumns} getRowId={item => item.id} onRowAction={item => openSpecification(item.entry, 'dimensions')} showToolbar={false} selectable={false} pageSize={25} emptyTitle="No requirements to measure" emptyDescription="Add a requirement in the Requirements tab, then enter its measurements here."/>
      : <DataGrid key={view} appearance="flush" ariaLabel={view === 'file' ? 'Site plans' : view === 'inspiration' ? 'Client inspirations' : 'Requirements'} data={rows} columns={columns} getRowId={item => item.id} onRowAction={setEntry} showToolbar={false} selectable={false} pageSize={25} emptyTitle={view === 'file' ? 'No site plans yet' : view === 'inspiration' ? 'No inspiration yet' : 'No requirements yet'} emptyDescription={view === 'file' ? 'Upload site plans, drawings and layout references.' : 'Choose a room and add a requirement.'}/>}</div>}
  </div>;
  const editingNote = entry ? linkedNotes.get(entry.id) : undefined;
  return <div className={styles.content}>
    {initialView !== 'inspiration' && <section className={styles.coverage} aria-label="Discovery coverage">
      <dl className={styles.coverageSummary}>
        <div><dt>Rooms covered</dt><dd>{coverage.roomCount ? `${coverage.coveredRoomCount} of ${coverage.roomCount}` : 'No rooms yet'}</dd></div>
        <div><dt>Client drafts</dt><dd>{coverage.clientDraftItemIds.length ? `${coverage.clientDraftItemIds.length} to review` : 'Clear'}</dd></div>
        <div><dt>Scope decisions</dt><dd>{coverage.undecidedItemIds.length ? `${coverage.undecidedItemIds.length} open` : 'Clear'}</dd></div>
        <div><dt>Measurements</dt><dd>{coverage.missingMeasurementItemIds.length ? `${coverage.missingMeasurementItemIds.length} need verification` : 'Clear'}</dd></div>
      </dl>
      {coverage.uncoveredRooms.length > 0 && <p><strong>Rooms without requirements:</strong> {coverage.uncoveredRooms.map(item => item.name).join(', ')}</p>}
    </section>}
    <div className={styles.register}>{initialView === 'inspiration' ? panel : <Tabs className="wd-tabs" selectedKey={tab} onSelectionChange={changeTab}>
      <div className={styles.viewBar}>
        <TabList aria-label="Requirement sections" className="wd-tab-list">{gatheringTabs.map(item => <Tab key={item.id} id={item.id} className="wd-tab"><item.icon size={14}/>{item.label}</Tab>)}</TabList>
        <div className={styles.actions}><Button size="compact" variant="quiet" onPress={() => setBriefOpen(true)}><ClipboardList size={14}/>Project brief</Button><Button size="compact" variant="quiet" onPress={() => setRoomsOpen(true)}><DoorOpen size={14}/>Rooms</Button></div>
      </div>
      <TabPanel id={tab} className={styles.registerPanel}>{panel}</TabPanel>
    </Tabs>}</div>
    {entry && <ScopeEditor key={entry.id} entry={entry} data={{ ...data, canEdit: canEditEntry(entry) }} assetUrl={(asset, preview) => assetUrl(entry, asset, preview)} uploadFile={editingNote ? (file, id) => sharedNotes.upload(editingNote.id, file, id) : undefined} onClose={() => { setEntry(null); setMeasureAfterSave(false); }} onSpecifications={() => { openSpecification(entry); setEntry(null); }} onSave={async draft => { const saved = await saveEntry(draft); if (measureAfterSave) { setEntry(null); setMeasureAfterSave(false); setMeasurementFor(saved.id); setMeasurementOpen(true); } return saved; }} onArchive={async value => { await saveEntry(entry, value); setEntry(null); setMessage(value ? 'Archived.' : 'Restored.'); }}/>}
    {measurementOpen && <MeasurementCreateForm data={data} entries={allEntries.filter(value => storedRequirement(value) && !value.archivedAt && canEditEntry(value))} initialEntryId={measurementFor} initialRoom={room} onClose={() => setMeasurementOpen(false)} onCreateRequirement={() => { setMeasurementOpen(false); setMeasureAfterSave(true); setEntry(blankEntry(room === 'all' || room === 'general' ? null : room)); }} onSaved={(value, specification) => { upsert({ ...value, assets: data.entries.find(item => item.id === value.id)?.assets ?? value.assets, specification }); setSearch(''); setRoom(value.roomId ?? 'general'); setMessage('Measurement saved.'); setMeasurementOpen(false); }}/>} 
    {specEntry && <ItemSpecificationEditor entry={specEntry} data={{ ...data, canEdit: canEditEntry(specEntry) }} focusSection={specFocus} onClose={() => setSpecEntry(null)} onSaved={specification => { upsert({ ...specEntry, assets: data.entries.find(item => item.id === specEntry.id)?.assets ?? specEntry.assets, specification }); setSpecEntry(null); setMessage('Measurements saved.'); }}/>}
    {briefOpen && <BriefEditor data={data} onClose={() => setBriefOpen(false)} onSave={async brief => { const input = { ...brief }; delete input.updatedAt; const saved = await caseRequest<CaseBrief>(workspaceId, caseId, 'brief', 'PUT', input); setData(current => ({ ...current, brief: saved, fromCrm: false })); setMessage('Brief saved.'); }}/>}
    {roomsOpen && <RoomManager data={data} onClose={() => setRoomsOpen(false)} onSave={async value => { const saved = await caseRequest<CaseRoom>(workspaceId, caseId, 'rooms', 'PUT', { id: value.id, version: value.version, name: value.name, catalogRecordId: value.catalogRecordId ?? null }); setData(current => ({ ...current, rooms: [...current.rooms.filter(item => item.id !== saved.id), saved], entries: current.entries.map(item => item.roomId === saved.id ? { ...item, roomName: saved.name } : item) })); return saved; }}/>}
    {bulk && <ScopePaste data={data} initialRoom={room === 'all' || room === 'general' ? null : room} onClose={() => setBulk(false)} onSave={async entries => { const result = await caseRequest<{ items: ScopeEntry[] }>(workspaceId, caseId, 'entries/bulk', 'POST', { entries: entries.map(entryPayload) }); setData(current => ({ ...current, entries: [...result.items, ...current.entries.filter(item => !result.items.some(saved => saved.id === item.id))] })); setMessage(`${result.items.length} requirements added.`); }}/>}
  </div>;
}

function BriefEditor({data,onClose,onSave}:{data:CaseContent;onClose:()=>void;onSave:(brief:CaseBrief)=>Promise<void>}) {
 const {locale}=useDesignSystem();
 const [draft,setDraft]=useState(data.brief);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const change=(key:string,value:string)=>setDraft(d=>({...d,[key]:value}));
 const field=(key:keyof typeof briefFields,large=false)=><label key={key} className={large?styles.full:undefined}>{briefFields[key]}{large?<textarea value={draft[key]} maxLength={key==='goals'?6000:3000} onChange={e=>change(key,e.target.value)}/>:<input value={draft[key]} maxLength={key==='propertyType'?240:key==='area'?120:key==='timeline'||key==='budget'?500:1000} onChange={e=>change(key,e.target.value)}/>}</label>;
 return <CaseModal title="Project brief" description="Confirm the context, budget and constraints before detailing each room." onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(data.brief)} busy={saving} footer={data.canEdit&&<Button type="submit" form="brief-form" variant="primary" isLoading={saving}>Save brief</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<form id="brief-form" onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await onSave(draft);onClose();}catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setSaving(false);}}}><fieldset disabled={saving||!data.canEdit}><div className={styles.grid}>{field('goals',true)}{field('propertyType')}{field('area')}{field('location')}{field('timeline')}
 <label>Budget amount · {draft.currencyCode}<input inputMode="decimal" value={draft.budgetAmount} placeholder="Enter amount" onChange={e=>change('budgetAmount',e.target.value)}/></label><SelectField label="Budget currency" isDisabled={saving||!data.canEdit} selectedKey={draft.currencyCode} onSelectionChange={k=>{if(k&&String(k)!==draft.currencyCode)setDraft(d=>({...d,currencyCode:String(k),budgetAmount:''}));}} description="Changing currency clears the amount. Enter the agreed budget; no conversion is applied." items={Array.from(new Set([draft.currencyCode,data.crmContext.currencyCode??'INR','INR','AED','USD','EUR','GBP','SAR','SGD'])).map(id=>({id,label:id}))}/>{field('budget')}{field('decisionMakers')}</div>
 <details><summary>People, preferences & constraints</summary><div className={styles.grid}>{field('people',true)}{field('preferences',true)}{field('retainedItems',true)}{field('exclusions',true)}{field('constraints',true)}</div></details></fieldset></form>
 {data.crmContext.opportunityAmount&&<p className={styles.muted}>CRM opportunity value: {formatCaseMoney(data.crmContext.opportunityAmount,data.crmContext.currencyCode??draft.currencyCode,locale)}. This remains separate from the client’s budget.</p>}
 </CaseModal>;
}

function RoomManager({data,onClose,onSave}:{data:CaseContent;onClose:()=>void;onSave:(room:CaseRoom)=>Promise<CaseRoom>}) {
 const [draft,setDraft]=useState<CaseRoom|null>(null);const [baseline,setBaseline]=useState<CaseRoom|null>(null);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 return <CaseModal title="Project rooms" description="Use rooms from Master Data or name your own spaces, such as Bedroom 2." onClose={onClose} dirty={draft!==null&&JSON.stringify(draft)!==JSON.stringify(baseline)} busy={saving} size="md" footer={draft&&<Button variant="primary" type="submit" form="room-form" isLoading={saving}>Save room</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.rooms}>{data.rooms.map(r=><div className={styles.room} key={r.id}><DoorOpen size={17}/><span>{r.name}<small className={styles.muted}>{r.catalogSnapshot?` · ${r.catalogSnapshot.name}`:''}</small></span>{data.canEdit&&<Button size="compact" isDisabled={Boolean(draft)||saving} onPress={()=>{setDraft(r);setBaseline(r);}}>Edit</Button>}</div>)}</div>
 {!data.rooms.length&&<p className={styles.muted}>No rooms yet. Whole-project requirements can be entered straight away.</p>}
 {!draft&&data.canEdit&&<div className={styles.divider}><Button onPress={()=>{const fresh={id:crypto.randomUUID(),version:0,name:'',catalogRecordId:null};setDraft(fresh);setBaseline(fresh);}}><Plus size={15}/>Add room</Button></div>}
 {draft&&<form id="room-form" className={styles.divider} onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await onSave(draft);setDraft(null);setBaseline(null);}catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setSaving(false);}}}><fieldset disabled={saving}><CatalogChoiceField workspaceId={data.workspaceId} caseId={data.caseId} kind="room" label="Master Data room · optional" value={draft.catalogSnapshot??null} disabled={saving} onChange={value=>setDraft(d=>d?{...d,catalogRecordId:value?.id??null,catalogSnapshot:value,name:d.name||value?.name||''}:d)}/><label className={styles.divider}>Room name<input required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. Master bedroom"/></label></fieldset></form>}
 </CaseModal>;
}

function ScopePaste({data,initialRoom,onClose,onSave}:{data:CaseContent;initialRoom:string|null;onClose:()=>void;onSave:(entries:ScopeEntry[])=>Promise<void>}) {
 const [room,setRoom]=useState(initialRoom);const [text,setText]=useState('');const [entries,setEntries]=useState<ScopeEntry[]>([]);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 return <CaseModal title="Paste scope items" description="Copy up to 100 rows from Excel, without column headers. Custom items can be linked to catalogs after entry." onClose={onClose} busy={saving} dirty={Boolean(text)} footer={<Button variant="primary" isDisabled={saving||!entries.length} isLoading={saving} onPress={async()=>{setSaving(true);setError('');try{await onSave(entries.map(e=>({...e,roomId:room})));onClose();}catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setSaving(false);}}}>Add {entries.length||''} items</Button>}>
 {error&&<p className={styles.error} role="alert">{error}</p>}<SelectField label="Room for these items" isDisabled={saving} selectedKey={room??'general'} onSelectionChange={k=>setRoom(k==='general'?null:String(k))} items={[{id:'general',label:'Whole project'},...data.rooms.map(r=>({id:r.id,label:r.name}))]}/>
 <label className={styles.divider}>Columns: Item → Quantity → Unit → Notes<textarea disabled={saving} value={text} rows={7} placeholder={'Sliding wardrobe\t72\tsq.ft\t8 × 9 ft, factory-made\nStudy desk\t1\tnos\tWith storage'} onChange={e=>{setText(e.target.value);setEntries([]);setError('');}}/></label><p className={styles.muted}>Item name is required. Quantity, unit and notes are optional. Rows start as “To decide”; no prices or approvals are created.</p><Button isDisabled={saving||!text.trim()} onPress={()=>{try{setEntries(parseScopePaste(text,room));setError('');}catch(err){setError(err instanceof Error?err.message:'Check the pasted rows.');}}}>Review rows</Button>
 {entries.length>0&&<DataGrid ariaLabel="Requirement import preview" data={entries} getRowId={e=>e.id} selectable={false} searchLabel="Search pasted requirements" exportFileName="requirement-import.csv" columns={[
 {accessorKey:'title',header:'Item',size:250},{accessorKey:'quantity',header:'Quantity',size:110},{accessorKey:'unit',header:'Unit',size:100},{accessorKey:'note',header:'Requirement note',size:300},
 ]}/>} 
 </CaseModal>;
}
