"use client";

import { useId, useState, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ClipboardList, DoorOpen, FileText, LayoutGrid, Plus, Ruler, Table2 } from 'lucide-react';
import { Badge, Button, Checkbox, DataGrid, MenuButton, SelectField, SearchInput, TextInput, TextAreaField, NumericInput, useDesignSystem, type DataGridColumn } from '@/design-system';
import { blankEntry, briefFields, caseApi, caseRequest, entryPayload, formatCaseMoney, scopeLabels, type CaseBrief, type CaseContent, type CaseRoom, type ScopeEntry, type ItemDimension } from '@/lib/pre-project/content';
import { documentText, mediaIds, textDocument, type RequirementNote } from '@/lib/crm/note-document';
import { CaseModal, CatalogChoiceField } from './case-controls';
import { ItemSpecificationEditor } from './item-specification-editor';
import { MeasurementCreateForm } from './measurement-create-form';
import { ScopeEditor } from './scope-entry-editor';
import { useRequirementNotes } from '../crm/requirement-notes';
import workspace from './requirements-workspace.module.css';
import { DimensionReadout } from './scope-note-cards';
import tableStyles from '../crm/leads-page.module.css';
import styles from './case-content.module.css';

type GatheringTab = 'requirement' | 'measurements' | 'file';
type MeasurementRow = { id: string; entry: ScopeEntry; dimension?: ItemDimension };

export function BriefScopePage({ initialData, view: initialView = 'requirement', readOnlyReason, compact = false }: { initialData: CaseContent; readOnlyReason?: string; view?: GatheringTab | 'inspiration'; compact?: boolean }) {
  const searchParams = useSearchParams();
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
  const [addingRoom, setAddingRoom] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { locale } = useDesignSystem();
  const { workspaceId, caseId } = data;
  const blockedReason = readOnlyReason ?? 'Your role does not have permission to edit this record.';
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
    if (!canEditEntry(draft)) throw new Error('This requirement is read only.');
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
      setMessage('Requirement saved.');
      return noteEntry(savedNote);
    }
    const saved = await caseRequest<ScopeEntry>(workspaceId, caseId, 'entries', 'PUT', { ...entryPayload({ ...draft, document }), archived: archive ?? Boolean(draft.archivedAt) });
    upsert(saved); setMessage(view === 'file' ? 'Site plan saved.' : 'Saved.'); return saved;
  };
  const visible = allEntries.filter(item => (archived ? Boolean(item.archivedAt) : !item.archivedAt)
    && (room === 'all' || (item.roomId ?? 'general') === room)
    && `${item.title} ${item.note} ${item.roomName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const rows = visible.filter(item => view === 'requirement' ? ['requirement', 'note', 'file', 'inspiration'].includes(item.kind) : item.kind === view);
  const measurementRows: MeasurementRow[] = visible.filter(storedRequirement).flatMap(value => value.specification?.dimensions.length
    ? value.specification.dimensions.map(dimension => ({ id: `${value.id}:${dimension.id}`, entry: value, dimension }))
    : []);
  const cardEntries = view === 'measurements' ? visible.filter(storedRequirement) : rows;
  const measurementColumns: DataGridColumn<MeasurementRow>[] = [
    { id:'item',header:'Item',size:260,accessorFn:row=>row.entry.title,cell:({row:{original}})=><div className={workspace.rowSummary}><strong>{original.entry.title}</strong><span>{data.rooms.find(room=>room.id===original.entry.roomId)?.name??original.entry.roomName??'Whole project'}</span></div> },
    { id:'dimension',header:'Dimension',size:150,accessorFn:row=>row.dimension?.name??'' },
    { id:'measured',header:'Measured size',size:150,accessorFn:row=>row.dimension?.measured!=null?`${row.dimension.measured} ${row.dimension.unit}`:'Not measured' },
    { id:'action',header:'',size:90,cell:({row:{original}})=><Button size="compact" variant="quiet" aria-label={`${!canEditEntry(original.entry)||archived?'View':'Edit'} measurements for ${original.entry.title}`} onPress={()=>openSpecification(original.entry,'dimensions')}>{!canEditEntry(original.entry)||archived?'View':'Edit'}</Button> },
  ];
  const columns: DataGridColumn<ScopeEntry>[] = [
    { accessorKey: 'title', header: view === 'file' ? 'Site plan' : view === 'inspiration' ? 'Inspiration' : 'Requirement', size: 320, cell: ({ row: { original } }) => <div className={workspace.rowSummary}><strong>{original.title}</strong>{original.note && <span>{original.note}</span>}</div> },
    { id: 'roomName', header: 'Room', size: 155, accessorFn: item => data.rooms.find(value => value.id === item.roomId)?.name ?? item.roomName ?? 'Whole project' },
    ...(view === 'requirement' ? [
      { id: 'quantity', header: 'Quantity', size: 115, accessorFn: item => item.quantity != null ? `${item.quantity} ${item.unit}` : '—' },
      { id: 'scope', header: 'Scope', size: 135, accessorFn: item => scopeLabels[item.scopeStatus] ?? item.scopeStatus, cell: ({ row: { original } }) => original.kind === 'requirement' ? <Badge tone={original.scopeStatus === 'included' ? 'success' : original.scopeStatus === 'undecided' ? 'warning' : 'neutral'}>{scopeLabels[original.scopeStatus] ?? original.scopeStatus}</Badge> : <Badge tone="neutral">{original.kind === 'note' ? 'Note' : original.kind === 'file' ? 'Reference file' : 'Inspiration'}</Badge> },
      { id: 'measurements', header: 'Measurements', size: 170, cell: ({ row: { original } }) => storedRequirement(original) ? <Button size="compact" variant="quiet" onPress={() => openSpecification(original, 'dimensions')}>{original.specification?.dimensions?.length ? 'View measurements' : canEditEntry(original) && !archived ? 'Add measurements' : 'Not entered'}</Button> : <span>—</span> },
    ] as DataGridColumn<ScopeEntry>[] : [
      { id: 'files', header: 'Files', size: 180, cell: ({ row: { original } }) => <span className={styles.referenceCell}>{original.assets[0]?.hasPreview && <Image alt="" unoptimized width={40} height={40} src={assetUrl(original, original.assets[0], true)}/>}<span>{original.assets.length ? `${original.assets.length} file${original.assets.length === 1 ? '' : 's'}` : original.referenceUrl ? 'Linked reference' : 'No attachment'}</span></span> },
      { id: 'source', header: 'Captured from', size: 125, accessorFn: item => item.source === 'client' ? 'Client' : 'Team' },
    ] as DataGridColumn<ScopeEntry>[]),
    { id: 'action', header: '', size: 100, cell: ({ row: { original } }) => <Button size="compact" variant="quiet" aria-label={`${canEditEntry(original) && !archived ? 'Edit' : 'View'} ${original.title}`} onPress={() => setEntry(original)}>{canEditEntry(original) && !archived ? 'Edit' : 'View'}</Button> },
  ];
  const captureActions = <div className={`${styles.toolbarActions} ${workspace.captureActions}`}>
        {view !== 'requirement' && view !== 'measurements' && <div className={styles.presentationSwitch} role="group" aria-label="Display"><button type="button" aria-label="Cards view" aria-pressed={presentation === 'cards'} onClick={() => setPresentation('cards')}><LayoutGrid size={15}/></button><button type="button" aria-label="Table view" aria-pressed={presentation === 'table'} onClick={() => setPresentation('table')}><Table2 size={15}/></button></div>}
        {view === 'measurements' && <EligibilityButton reason={blockedReason} isDisabled={!data.canEdit} size="compact" variant="primary" onPress={() => { setArchived(false); setMeasurementFor(undefined); setMeasurementOpen(true); }}><Plus size={14}/>Add measurement</EligibilityButton>}
        {view !== 'measurements' && <EligibilityButton reason={blockedReason} isDisabled={!data.canEdit} size="compact" variant="primary" onPress={() => { setArchived(false); setEntry({ ...blankEntry(room === 'all' || room === 'general' ? null : room), kind: view }); }}><Plus size={14}/>{view === 'file' ? 'Add site plan' : view === 'inspiration' ? 'Add inspiration' : 'Add requirement'}</EligibilityButton>}
      </div>;
  const panel = <div className={styles.registerPanel}>
    <div className={`${styles.compactToolbar} ${workspace.toolbar}`}>
      <SearchInput label={view === 'measurements' ? 'Search measurements' : view === 'file' ? 'Search site plans' : view === 'inspiration' ? 'Search inspirations' : 'Search requirements'} value={search} onChange={setSearch} placeholder={view === 'measurements' ? 'Search measurements…' : view === 'file' ? 'Search site plans…' : view === 'inspiration' ? 'Search inspiration…' : 'Search requirements…'}/>
      <div className={workspace.roomFilter}><SelectField label="Room" selectedKey={compact && archived ? 'archived' : room} onSelectionChange={key => { if (compact) { setArchived(key === 'archived'); setRoom(key === 'archived' ? 'all' : String(key ?? 'all')); } else setRoom(String(key ?? 'all')); }} items={[{id:'all',label:'All rooms'},{id:'general',label:'Whole project'},...data.rooms.map(value => ({id:value.id,label:value.name})),...(compact ? [{id:'archived',label:'Archived requirements'}] : [])]}/></div>
      {!compact && <Checkbox isSelected={archived} onChange={setArchived}>Archived</Checkbox>}
      {captureActions}
    </div>
    {view !== 'inspiration' && sharedNotes.loading && <p role="status" className={styles.muted}>Loading requirements…</p>}
    {view !== 'inspiration' && sharedNotes.failure && <p className={styles.error} role="alert">{sharedNotes.failure}<Button size="compact" variant="quiet" onPress={sharedNotes.refresh}>Retry</Button></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={compact ? workspace.srOnly : styles.notice}>{message}</p>}
    {sharedNotes.loading && !allEntries.length && view !== 'inspiration' ? null : (view === 'requirement' || presentation === 'cards') ? <div className={workspace.cards}>{cardEntries.map(value => {
      return <article className={workspace.card} data-tone={Math.abs([...value.id].reduce((hash,letter) => (Math.imul(hash,31) + letter.charCodeAt(0)) | 0, 0)) % 5} key={value.id} aria-label={value.title}>
        <div className={workspace.body}>
          <div className={workspace.meta}><span>{data.rooms.find(r => r.id === value.roomId)?.name ?? value.roomName ?? 'Whole project'}</span>{!compact && (value.kind === 'requirement' && canEditEntry(value) && !archived ? <MenuButton label={scopeLabels[value.scopeStatus]} items={[{id:'included',label:'Include in scope'},{id:'excluded',label:'Exclude from scope'},{id:'undecided',label:'Decide later'}]} onAction={key => {  void saveEntry({...value,scopeStatus:String(key)}).catch(failure=>setError(failure instanceof Error?failure.message:'Could not update scope.')); }} /> : <span data-status={value.scopeStatus}>{value.kind === 'file' ? 'Site file' : value.kind === 'inspiration' ? 'Inspiration' : scopeLabels[value.scopeStatus]}</span>)}</div>
          <button className={workspace.title} aria-label={`Open details for ${value.title}`} onClick={() => view === 'measurements' ? openSpecification(value, 'dimensions') : setEntry(value)}>{value.title}</button>
          {view === 'measurements' ? <div className={workspace.measurementPreview}>{value.specification?.dimensions.length ? <DimensionReadout dimensions={value.specification.dimensions.slice(0,2)} /> : <p className={workspace.note}>No measurements yet.</p>}</div> : value.note && <p className={workspace.note}>{value.note.replace(/\s+/g, " ").trim()}</p>}
          {value.assets.length > 0 && <div className={workspace.attachmentStrip} aria-label={`${value.assets.length} attachments`}>{value.assets.slice(0,3).map(asset => <button type="button" key={asset.id} title={asset.name} aria-label={`View ${asset.name}`} onClick={() => setEntry(value)}>{asset.hasPreview ? <Image unoptimized src={assetUrl(value,asset,true)} alt="" width={28} height={28}/> : <FileText size={16}/>}<span>{asset.name}</span></button>)}{value.assets.length > 3 && <span className={workspace.moreAttachments}>+{value.assets.length-3}</span>}</div>}
          <div className={workspace.footer}>
            <Button size="compact" variant="quiet" aria-label={`${canEditEntry(value) && !archived ? 'Edit' : 'View'} ${view === 'measurements' ? 'measurements for ' : ''}${value.title}`} onPress={() => view === 'measurements' ? openSpecification(value, 'dimensions') : setEntry(value)}>{canEditEntry(value) && !archived ? 'Edit' : 'View'} {view === 'measurements' ? 'sizes' : value.kind === 'file' ? 'plan' : 'note'} ↗</Button>
            {!compact && canEditEntry(value) && <MenuButton label="Actions" items={[
              ...(!archived && value.kind === 'requirement' ? [{id:'specifications',label:'Measurements'}] : []),
              ...(archived ? [] : [{id:'room:general',label:'Move to whole project'},...data.rooms.map(item=>({id:`room:${item.id}`,label:`Move to ${item.name}`}))]),
              {id:archived?'restore':'archive',label:archived?'Restore':'Archive'},
            ]} onAction={key => { if(key === 'specifications'){openSpecification(value,'dimensions');return;} const changed = key.startsWith('room:') ? {...value,roomId:key === 'room:general' ? null : key.slice(5)} : value; void saveEntry(changed,key === 'archive' ? true : key === 'restore' ? false : undefined).then(()=>setMessage(key === 'archive' ? 'Archived. Find this item using the Archived filter.' : key === 'restore' ? 'Restored.' : 'Room updated.')).catch(failure=>setError(failure instanceof Error?failure.message:'Could not update this item.')); }} />}
          </div>
        </div>
      </article>;
    })}{!cardEntries.length && <div className={workspace.empty}>{archived ? "No archived items match these filters." : search || room !== "all" ? "No items match these filters." : view === "file" ? "Add a floor plan, survey or site drawing." : view === "inspiration" ? "Collect photos, links and ideas the client likes." : "Add a note to capture what the client needs."}</div>}</div> : <div className={tableStyles.recordTablePanel}>{view === 'measurements'
      ? <DataGrid key="measurements" appearance="flush" ariaLabel="Measurements" data={measurementRows} columns={measurementColumns} getRowId={item => item.id} onRowAction={item => openSpecification(item.entry, 'dimensions')} showToolbar={false} selectable={false} pageSize={25} emptyTitle="No measurements yet" emptyDescription="Choose an item or type a name, then add its measurements."/>
      : <DataGrid key={view} appearance="flush" ariaLabel={view === 'file' ? 'Site plans' : view === 'inspiration' ? 'Client inspirations' : 'Requirements'} data={rows} columns={columns} getRowId={item => item.id} onRowAction={setEntry} showToolbar={false} selectable={false} pageSize={25} emptyTitle={view === 'file' ? 'No site plans yet' : view === 'inspiration' ? 'No inspiration yet' : 'No requirements yet'} emptyDescription={view === 'file' ? 'Upload site plans, drawings and layout references.' : 'Choose a room and add a requirement.'}/>}</div>}
  </div>;
  const editingNote = entry ? linkedNotes.get(entry.id) : undefined;
  return <div className={`${styles.content} ${compact ? workspace.compact : ''}`}>
    <div className={workspace.workspace}>
      <div className={workspace.main}>
        {!compact && <div className={workspace.heading}>
          <div><h2>{view === 'requirement' ? 'Requirements' : view === 'measurements' ? 'Measurements' : view === 'file' ? 'Site plans' : 'Inspiration'}</h2><p>{view === 'requirement' ? 'What the client needs, with notes, photos and specifications in one place.' : 'Keep project information connected to the right room and requirement.'}</p></div>
          <div className={workspace.actions}><Button size="compact" variant="quiet" onPress={() => setBriefOpen(true)}>Project brief</Button><Button size="compact" variant="quiet" onPress={() => { setAddingRoom(false); setRoomsOpen(true); }}>Manage rooms</Button></div>
        </div>}
        {!data.canEdit && <p className={workspace.readOnly} role="note">{blockedReason}</p>}
        {panel}
      </div>
    </div>
    {entry && <ScopeEditor key={entry.id} entry={entry} data={{ ...data, canEdit: canEditEntry(entry) }} assetUrl={(asset, preview) => assetUrl(entry, asset, preview)} uploadFile={editingNote ? (file, id) => sharedNotes.upload(editingNote.id, file, id) : undefined} onClose={() => { setEntry(null); setMeasureAfterSave(false); }} onSpecifications={() => { openSpecification(entry); setEntry(null); }} onSave={async draft => { const saved = await saveEntry(draft); if (measureAfterSave) { setEntry(null); setMeasureAfterSave(false); setMeasurementFor(saved.id); setMeasurementOpen(true); } return saved; }} onArchive={async value => { await saveEntry(entry, value); setEntry(null); setMessage(value ? 'Archived.' : 'Restored.'); }}/>}
    {measurementOpen && <MeasurementCreateForm data={data} entries={allEntries.filter(value => storedRequirement(value) && !value.archivedAt && canEditEntry(value))} initialEntryId={measurementFor} initialRoom={room} onClose={() => setMeasurementOpen(false)} onCreateRequirement={() => { setMeasurementOpen(false); setMeasureAfterSave(true); setEntry(blankEntry(room === 'all' || room === 'general' ? null : room)); }} onSaved={(value, specification) => { upsert({ ...value, assets: data.entries.find(item => item.id === value.id)?.assets ?? value.assets, specification }); setSearch(''); setRoom(value.roomId ?? 'general'); setMessage('Measurement saved.'); setMeasurementOpen(false); }}/>} 
    {specEntry && <ItemSpecificationEditor entry={specEntry} data={{ ...data, canEdit: canEditEntry(specEntry) }} focusSection={specFocus} onClose={() => setSpecEntry(null)} onSaved={specification => { upsert({ ...specEntry, assets: data.entries.find(item => item.id === specEntry.id)?.assets ?? specEntry.assets, specification }); setSpecEntry(null); setMessage('Measurements saved.'); }}/>}
    {briefOpen && <BriefEditor data={data} onClose={() => setBriefOpen(false)} onSave={async brief => { const input = { ...brief }; delete input.updatedAt; const saved = await caseRequest<CaseBrief>(workspaceId, caseId, 'brief', 'PUT', input); setData(current => ({ ...current, brief: saved, fromCrm: false })); setMessage('Brief saved.'); }}/>}
    {roomsOpen && <RoomManager startAdding={addingRoom} data={data} onClose={() => setRoomsOpen(false)} onSave={async value => { const saved = await caseRequest<CaseRoom>(workspaceId, caseId, 'rooms', 'PUT', { id: value.id, version: value.version, name: value.name, catalogRecordId: value.catalogRecordId ?? null }); setData(current => ({ ...current, rooms: [...current.rooms.filter(item => item.id !== saved.id), saved], entries: current.entries.map(item => item.roomId === saved.id ? { ...item, roomName: saved.name } : item) })); return saved; }}/>}
  </div>;
}

function BriefEditor({data,onClose,onSave}:{data:CaseContent;onClose:()=>void;onSave:(brief:CaseBrief)=>Promise<void>}) {
 const {locale}=useDesignSystem();
 const [draft,setDraft]=useState(data.brief);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const change=(key:string,value:string)=>setDraft(d=>({...d,[key]:value}));
 const field=(key:keyof typeof briefFields,large=false)=><div key={key} className={large?styles.full:undefined}>{large?<TextAreaField label={briefFields[key]} isDisabled={saving||!data.canEdit} value={draft[key]} maxLength={key==='goals'?6000:3000} onChange={value=>change(key,value)}/>:<TextInput label={briefFields[key]} isDisabled={saving||!data.canEdit} value={draft[key]} maxLength={key==='propertyType'?240:key==='area'?120:key==='timeline'||key==='budget'?500:key==='retainedItems'||key==='exclusions'?3000:1000} onChange={value=>change(key,value)}/>}</div>;
 return <CaseModal title="Project brief" description="Confirm the context, budget and constraints before detailing each room." onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(data.brief)} busy={saving} footer={data.canEdit&&<Button type="submit" form="brief-form" variant="primary" isLoading={saving}>Save brief</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<form id="brief-form" onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await onSave(draft);onClose();}catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setSaving(false);}}}><fieldset disabled={saving||!data.canEdit}><div className={styles.grid}>{field('goals',true)}{field('propertyType')}{field('area')}{field('location')}{field('timeline')}
 <NumericInput label="Budget amount" prefix={draft.currencyCode} isDisabled={saving||!data.canEdit} minValue={0} maxValue={1e12} formatOptions={{maximumFractionDigits:2}} value={draft.budgetAmount ? Number(draft.budgetAmount) : NaN} onChange={value=>change('budgetAmount',Number.isFinite(value)?String(value):'')}/>
 {field('budget')}{field('decisionMakers')}</div>
 <section className={styles.divider}><h3>People, preferences & constraints</h3><div className={styles.grid}>{field('people',true)}{field('preferences',true)}{field('retainedItems')}{field('exclusions')}{field('constraints',true)}</div></section></fieldset></form>
 {data.crmContext.opportunityAmount&&<p className={styles.muted}>CRM opportunity value: {formatCaseMoney(data.crmContext.opportunityAmount,data.crmContext.currencyCode??draft.currencyCode,locale)}. This remains separate from the client’s budget.</p>}
 </CaseModal>;
}

function RoomManager({data,onClose,onSave,startAdding=false}:{startAdding?:boolean;data:CaseContent;onClose:()=>void;onSave:(room:CaseRoom)=>Promise<CaseRoom>}) {
 const [draft,setDraft]=useState<CaseRoom|null>(()=>startAdding&&data.canEdit?{id:crypto.randomUUID(),version:0,name:'',catalogRecordId:null}:null);const [baseline,setBaseline]=useState<CaseRoom|null>(draft);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 return <CaseModal title="Project rooms" description="Organize requirements by room or area." onClose={onClose} dirty={draft!==null&&JSON.stringify(draft)!==JSON.stringify(baseline)} busy={saving} size="md" footer={draft&&<Button variant="primary" type="submit" form="room-form" isLoading={saving}>Save room</Button>}>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<div className={styles.rooms}>{data.rooms.map(r=><div className={styles.room} key={r.id}><DoorOpen size={17}/><span>{r.name}<small className={styles.muted}>{r.catalogSnapshot?` · ${r.catalogSnapshot.name}`:''}</small></span>{data.canEdit&&<Button size="compact" isDisabled={Boolean(draft)||saving} onPress={()=>{setDraft(r);setBaseline(r);}}>Edit</Button>}</div>)}</div>
 {!data.rooms.length&&!draft&&<p className={styles.muted}>No rooms yet. Whole-project requirements can be entered straight away.</p>}
 {!draft&&data.canEdit&&<div className={styles.divider}><Button onPress={()=>{const fresh={id:crypto.randomUUID(),version:0,name:'',catalogRecordId:null};setDraft(fresh);setBaseline(fresh);}}><Plus size={15}/>Add room</Button></div>}
 {draft&&<form id="room-form" onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{await onSave(draft);setDraft(null);setBaseline(null);}catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setSaving(false);}}}><fieldset disabled={saving} className={styles.captureFields}><TextInput label="Room name" isRequired isDisabled={saving} maxLength={120} value={draft.name} onChange={value=>setDraft({...draft,name:value})} placeholder="e.g. Master bedroom"/><CatalogChoiceField workspaceId={data.workspaceId} caseId={data.caseId} kind="room" label="Room catalog · optional" value={draft.catalogSnapshot??null} disabled={saving} onChange={value=>setDraft(d=>d?{...d,catalogRecordId:value?.id??null,catalogSnapshot:value,name:d.name||value?.name||''}:d)}/></fieldset></form>}
 </CaseModal>;
}

function EligibilityButton({ reason, ...props }: ComponentProps<typeof Button> & { reason: string }) {
  const id = useId();
  return <span className={workspace.blockedAction} tabIndex={props.isDisabled ? 0 : undefined} aria-label={props.isDisabled ? reason : undefined} aria-describedby={props.isDisabled ? id : undefined}>
    <Button {...props} />
    {props.isDisabled && <span id={id} role="tooltip" className={workspace.blockedTip}>{reason}</span>}
  </span>;
}
