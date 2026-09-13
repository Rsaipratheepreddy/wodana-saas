"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { ArrowUpRight, CalendarDays, Camera, ClipboardCheck, DoorOpen, Download, History, LayoutGrid, Pencil, Plus, Ruler } from 'lucide-react';
import { Button, SearchInput, SelectField, useDesignSystem } from '@/design-system';
import { caseApi, caseRequest, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { newSiteRecord, siteLabels, sitePayload, visitCalendar, visitDate, visitInstant, type SiteData, type SiteKind, type SiteRecord } from '@/lib/pre-project/site';
import { AssetFiles, AssetUpload, CaseModal } from './case-controls';
import { DimensionReadout } from './scope-note-cards';
import { SiteRecordEditor } from './site-record-editor';
import { SiteCalendar } from './site-calendar';
import styles from './case-content.module.css';
import cards from './scope-note-cards.module.css';
import siteStyles from './site.module.css';

const tabs:{id:SiteKind;label:string}[]=[{id:'visit',label:'Visits'},{id:'measurement',label:'Measurements'},{id:'observation',label:'Observations'}];
const paths={visit:'visits',measurement:'measurements',observation:'observations'};
const hints={visit:'Plan the survey, assign a team member and record the outcome.',measurement:'Check the existing rooms and items. Estimates stay visible beside measured values.',observation:'Keep photos, existing conditions and practical constraints connected to the room or item.'};

export function SitePage({initialData,initialSite,initialItem}:{initialData:CaseContent;initialSite:SiteData;initialItem?:string}) {
 const router=useRouter();const {locale}=useDesignSystem();
 const [data,setData]=useState(initialData);const [site,setSite]=useState(initialSite);const [view,setView]=useState<SiteKind>(initialItem?'measurement':'visit');
 const [search,setSearch]=useState('');const [room,setRoom]=useState('all');const [status,setStatus]=useState('all');const [message,setMessage]=useState('');const [error,setError]=useState('');const [limit,setLimit]=useState(24);
 const [selected,setSelected]=useState<SiteRecord|null>(()=>initialSite.items.find(r=>r.kind==='measurement'&&r.entryId===initialItem)??null);
 const [editing,setEditing]=useState<SiteRecord|null>(()=>{const item=initialData.entries.find(e=>e.id===initialItem&&e.kind==='requirement'&&!e.archivedAt);return item&&initialData.canEdit&&!initialSite.items.some(r=>r.kind==='measurement'&&r.entryId===item.id)?newSiteRecord('measurement',initialSite.timezone,item.roomId,item):null;});
 const [historyRecord,setHistoryRecord]=useState<SiteRecord|null>(null);const [review,setReview]=useState<SiteRecord|null>(null);
 const [photosOpen,setPhotosOpen]=useState(false);
 const [visitPresentation,setVisitPresentation]=useState<'calendar'|'cards'>('calendar');
 const calendarVisible=view==='visit'&&visitPresentation==='calendar';
 const {workspaceId,caseId}=data;
 const requirements=data.entries.filter(e=>e.kind==='requirement'&&!e.archivedAt);
 const pendingItems=view==='measurement'?requirements.filter(e=>!site.items.some(r=>r.kind==='measurement'&&r.entryId===e.id)):[];
 const filtered=site.items.filter(r=>r.kind===view&&(view==='visit'||room==='all'||(r.roomId??'whole')===room)&&(status==='all'||r.status===status)&&`${r.title} ${r.note} ${r.roomName??''} ${r.entryTitle??''} ${r.assigneeName??''}`.toLowerCase().includes(search.toLowerCase()));
 const pending=pendingItems.filter(e=>(room==='all'||(e.roomId??'whole')===room)&&(status==='all'||status==='not_surveyed')&&`${e.title} ${e.roomName??''} ${e.note}`.toLowerCase().includes(search.toLowerCase()));
 const ordered=view==='visit'?[...filtered].sort((a,b)=>Number(a.status!=='planned')-Number(b.status!=='planned')||(a.scheduledAt??'').localeCompare(b.scheduledAt??'')):filtered;
 const count=ordered.length+pending.length;
 const editRecord=(record:SiteRecord)=>{const entry=data.entries.find(e=>e.id===record.entryId);setSelected(null);setEditing(record.kind==='measurement'&&entry?{...record,dimensions:entry.specification?.dimensions??record.dimensions}:record);};
 const upsert=async(saved:SiteRecord)=>{
  setSite(current=>({...current,items:[saved,...current.items.filter(r=>r.id!==saved.id)]}));setMessage('Saved.');setError('');
  if(saved.kind==='measurement'){try{setData(await caseRequest<CaseContent>(workspaceId,caseId,'brief'));}catch{setError('Survey saved. Refresh this section to reload the linked item dimensions.');}}
  router.refresh();
 };
 const add=()=>{const record=newSiteRecord(view,site.timezone,room==='all'||room==='whole'?null:room);if(view==='visit')record.location=data.brief.location;setEditing(record);};
 const openPending=(entry:ScopeEntry)=>setEditing(newSiteRecord('measurement',site.timezone,entry.roomId,entry));
 const showHistory=(record:SiteRecord)=>{setSelected(null);setHistoryRecord(record);};
 return <div className={styles.content}>
  <Tabs selectedKey={view} onSelectionChange={key=>{setView(key as SiteKind);setStatus('all');setLimit(24);}} className={styles.register}>
   <div className={styles.viewBar}><TabList aria-label="Site survey views" className="wd-tab-list">{tabs.map(t=><Tab id={t.id} key={t.id} className="wd-tab">{t.label}</Tab>)}</TabList><div className={styles.actions}><Button size="compact" variant="quiet" onPress={()=>router.push(`/workspace/pre-projects/cases/${caseId}/requirements`)}><DoorOpen size={14}/>Rooms & requirements</Button></div></div>
   <TabPanel id={view} className={styles.registerPanel}>
    <div className={styles.compactToolbar}><SearchInput label="Search site records" placeholder={`Search ${paths[view]}…`} value={search} onChange={value=>{setSearch(value);setLimit(24);}}/>{view!=='visit'&&<div className={styles.compactFilter}><SelectField label="Room" selectedKey={room} onSelectionChange={key=>{if(key){setRoom(String(key));setLimit(24);}}} items={[{id:'all',label:'All rooms'},{id:'whole',label:'Whole project'},...data.rooms.map(r=>({id:r.id,label:r.name}))]}/></div>}<div className={styles.compactFilter}><SelectField label="Status" selectedKey={status} onSelectionChange={key=>{if(key){setStatus(String(key));setLimit(24);}}} items={[{id:'all',label:'All statuses'},...(view==='visit'?['planned','completed','cancelled']:view==='measurement'?['not_surveyed','incomplete','measured','verified','recheck']:['open','resolved']).map(id=>({id,label:siteLabels[id]??'Not surveyed'}))]}/></div><div className={styles.toolbarActions}>{view==='visit'&&<div className={styles.presentationSwitch} role="group" aria-label="Visit display"><button type="button" aria-label="Calendar view" aria-pressed={visitPresentation==='calendar'} onClick={()=>setVisitPresentation('calendar')}><CalendarDays size={15}/></button><button type="button" aria-label="Visit cards" aria-pressed={visitPresentation==='cards'} onClick={()=>setVisitPresentation('cards')}><LayoutGrid size={15}/></button></div>}{data.canEdit&&<Button size="compact" onPress={()=>setPhotosOpen(true)}><Camera size={14}/>Add photos</Button>}{data.canEdit&&<Button size="compact" variant="primary" onPress={add}><Plus size={14}/>{view==='visit'?'Schedule visit':view==='measurement'?'Add measurements':'Add observation'}</Button>}</div></div>
    {message&&<p role="status" className={styles.notice}>{message}</p>}{error&&<p role="alert" className={styles.error}>{error}<Button size="compact" onPress={()=>window.location.reload()}>Refresh</Button></p>}
    <p className={siteStyles.sectionHint}>{hints[view]}</p>
    <div hidden={calendarVisible}><div className={cards.board} aria-label={`${tabs.find(t=>t.id===view)?.label} cards`}>
     {ordered.slice(0,limit).map(record=>{
      const Icon=record.kind==='visit'?CalendarDays:record.kind==='measurement'?Ruler:Camera;
      const preview=record.assets.find(a=>a.hasPreview);
      return <article className={cards.noteCard} key={record.id} aria-label={record.title}>
       <div className={cards.meta}><span><Icon size={13}/>{record.kind==='visit'?'Site visit':record.roomName??'Whole project'}</span><span className={styles.status} data-status={record.status}>{siteLabels[record.status]}</span></div>
       <h3><button className={cards.openNote} onClick={()=>setSelected(record)} aria-label={`Open ${record.title}`}>{record.title}<ArrowUpRight size={14}/></button></h3>
       {preview&&<SiteImage key={preview.id} src={caseApi(workspaceId,caseId,`assets/${preview.id}?preview=1`)} name={preview.name}/>}
       {record.kind==='visit'?<><p className={siteStyles.visitTime}>{visitDate(record,locale)}</p><p className={styles.muted}>{record.timezone} · {record.durationMinutes} min</p><p className={siteStyles.copy}>{record.assigneeName??'Unassigned'}{record.location?` · ${record.location}`:''}</p></>:record.kind==='measurement'?<DimensionReadout dimensions={(record.dimensions??[]).map(d=>({...d,verification:record.status==='verified'?'verified':record.status==='recheck'?'recheck':'unverified'}))}/>:<p className={styles.muted}>{siteLabels[record.category??'other']}{record.entryTitle?` · ${record.entryTitle}`:''}</p>}
       {record.note&&<p className={`${cards.noteText} ${siteStyles.copy}`}>{record.note}</p>}
       <div className={cards.facts}>{record.visitTitle&&<span><CalendarDays size={12}/>{record.visitTitle}</span>}{record.assets.length>0&&<span>{record.assets.length} {record.assets.length===1?'file':'files'}</span>}{record.entryArchivedAt&&<span>Archived item</span>}<span>Revision {record.version}</span></div>
       <div className={cards.cardActions}><Button size="compact" variant="quiet" onPress={()=>showHistory(record)}><History size={13}/>History</Button>{data.canEdit&&!record.entryArchivedAt&&<Button size="compact" variant="quiet" onPress={()=>editRecord(record)}><Pencil size={13}/>{record.kind==='measurement'?'Update measurements':'Edit'}</Button>}</div>
      </article>;
     })}
     {pending.slice(0,Math.max(0,limit-ordered.length)).map(entry=><article className={cards.noteCard} key={entry.id} aria-label={entry.title}><div className={cards.meta}><span><DoorOpen size={13}/>{entry.roomName??'Whole project'}</span><span className={styles.status}>Not surveyed</span></div><h3><button className={cards.openNote} onClick={()=>openPending(entry)}>{entry.title}<ArrowUpRight size={14}/></button></h3>{entry.specification?.dimensions.length?<DimensionReadout dimensions={entry.specification.dimensions}/>:<p className={siteStyles.copy}>No dimensions captured yet.</p>}<div className={cards.facts}><span>From Brief & scope</span></div><div className={cards.cardActions}><Button size="compact" variant="quiet" onPress={()=>openPending(entry)}><Ruler size={13}/>{data.canEdit?'Start survey':'View measurements'}</Button></div></article>)}
    </div>
    {!count&&<div className={cards.empty}>{view==='visit'?<CalendarDays size={24}/>:view==='measurement'?<Ruler size={24}/>:<Camera size={24}/>}<strong>{search||status!=='all'||room!=='all'?'No matching records':view==='visit'?'Schedule the first site visit':view==='measurement'?'Capture the first measurements':'Add the first site observation'}</strong><p>{view==='visit'?'Choose a date, assign a team member and note what needs checking.':view==='measurement'?'Use an existing room or item, then record the dimensions.':'Add photos and a short note about the property.'}</p></div>}
    <div className={cards.boardFooter}><span>{Math.min(limit,count)} of {count} {paths[view]}</span>{count>limit&&<Button size="compact" onPress={()=>setLimit(n=>n+24)}>Show more</Button>}</div></div>
    {calendarVisible&&<SiteCalendar records={filtered} timezone={site.timezone} weekStartsOn={site.weekStartsOn} canEdit={data.canEdit} onOpen={setSelected} onSchedule={day=>{const record=newSiteRecord('visit',site.timezone);record.scheduledAt=visitInstant(`${day}T10:00`,site.timezone);record.location=data.brief.location;setEditing(record);}}/>}
   </TabPanel>
  </Tabs>
  {editing&&<SiteRecordEditor key={editing.id} initial={editing} data={data} site={site} onClose={()=>setEditing(null)} onSave={async(record,version)=>{await upsert(await caseRequest<SiteRecord>(workspaceId,caseId,`site/${paths[record.kind]}`,'PUT',sitePayload(record,version)));}}/>}
  {selected&&<CaseModal title={selected.title} description={`${selected.roomName??'Whole project'} · ${siteLabels[selected.status]} · Revision ${selected.version}`} onClose={()=>setSelected(null)} footer={<><Button size="compact" onPress={()=>showHistory(selected)}><History size={14}/>History</Button>{selected.kind==='visit'&&<Button size="compact" onPress={()=>{const url=URL.createObjectURL(new Blob([visitCalendar(selected)],{type:'text/calendar'}));const a=document.createElement('a');a.href=url;a.download='site-visit.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><Download size={14}/>Calendar file</Button>}{data.canEdit&&!selected.entryArchivedAt&&<><Button size="compact" onPress={()=>editRecord(selected)}><Pencil size={14}/>Edit</Button>{selected.kind==='measurement'&&site.canVerify&&<Button size="compact" variant="primary" onPress={()=>{setReview(selected);setSelected(null);}}><ClipboardCheck size={14}/>Review measurements</Button>}</>}</>}>
   <SiteRecordDetails record={selected} data={data}/>
  </CaseModal>}
  {historyRecord&&<SiteHistory record={historyRecord} data={data} onClose={()=>setHistoryRecord(null)}/>}
  {review&&<SiteReview record={review} data={data} onClose={()=>setReview(null)} onSaved={upsert}/>}
  {photosOpen&&<SitePhotos data={data} timezone={site.timezone} initialRoom={room==='all'||room==='whole'?null:room} onClose={()=>setPhotosOpen(false)} onSaved={async record=>{await upsert(record);setView('observation');setStatus('all');}}/>}
 </div>;
}

function SitePhotos({data,timezone,initialRoom,onClose,onSaved}:{data:CaseContent;timezone:string;initialRoom:string|null;onClose:()=>void;onSaved:(record:SiteRecord)=>Promise<void>}) {
 const [draft,setDraft]=useState(()=>({...newSiteRecord('observation',timezone,initialRoom),title:'Site photos'}));
 const [uploading,setUploading]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const disabled=uploading||saving;
 return <CaseModal size="md" title="Add site photos" description="Upload photos or a site plan, then add a short note and location." onClose={onClose} busy={disabled} dirty={draft.assets.length>0||Boolean(draft.note)||draft.title!=='Site photos'||draft.roomId!==initialRoom} footer={<Button size="compact" variant="primary" isDisabled={uploading} isLoading={saving} onPress={async()=>{if(!draft.assets.length){setError('Attach at least one image or PDF.');return;}if(!draft.title.trim()){setError('Add a short title for these photos.');return;}setSaving(true);setError('');try{await onSaved(await caseRequest<SiteRecord>(data.workspaceId,data.caseId,'site/observations','PUT',sitePayload(draft)));onClose();}catch(e){setError(e instanceof Error?e.message:'Could not save photos.');}finally{setSaving(false);}}}>Save photos</Button>}>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  <div className={styles.captureFields}><AssetUpload currentCount={draft.assets.length} workspaceId={data.workspaceId} caseId={data.caseId} disabled={disabled||draft.assets.length>=20} onBusy={setUploading} onError={setError} onUploaded={asset=>setDraft(d=>({...d,assets:[...d.assets,asset]}))}/><AssetFiles workspaceId={data.workspaceId} caseId={data.caseId} assets={draft.assets} onMarked={!disabled?asset=>setDraft(d=>({...d,assets:[...d.assets,asset]})):undefined} onRemove={!disabled?id=>setDraft(d=>({...d,assets:d.assets.filter(a=>a.id!==id)})):undefined}/><label>Photo title<input disabled={disabled} maxLength={240} value={draft.title} placeholder="e.g. Pantry water points" onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label><SelectField label="Room" isDisabled={disabled} selectedKey={draft.roomId??'whole'} items={[{id:'whole',label:'Whole project'},...data.rooms.map(r=>({id:r.id,label:r.name}))]} onSelectionChange={key=>key&&setDraft(d=>({...d,roomId:key==='whole'?null:String(key)}))}/><label>Notes · optional<textarea disabled={disabled} maxLength={6000} rows={3} value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))}/></label><p className={styles.muted}>Saved under Observations. You can link these photos to an item or visit there.</p></div>
 </CaseModal>;
}

function SiteImage({src,name}:{src:string;name:string}) {
 const [failed,setFailed]=useState(false);
 if(failed)return <p className={styles.muted}>{name}</p>;
 // Authenticated same-origin previews retain workspace access controls.
 // eslint-disable-next-line @next/next/no-img-element
 return <img src={src} alt={name} className={cards.noteImage} loading="lazy" onError={()=>setFailed(true)}/>;
}
function SiteRecordDetails({record,data}:{record:SiteRecord;data:CaseContent}) {
 const {locale}=useDesignSystem();
 return <>
  {record.kind==='visit'&&<dl className={siteStyles.detail}><dt>Scheduled</dt><dd>{visitDate(record,locale)} · {record.timezone} · {record.durationMinutes} min</dd><dt>Assigned to</dt><dd>{record.assigneeName??'Unassigned'}</dd><dt>Location</dt><dd>{record.location||'Not set'}</dd><dt>Access</dt><dd>{record.access||'No instructions'}</dd><dt>Outcome</dt><dd>{record.outcome||'Not recorded'}</dd></dl>}
  {record.entryTitle&&<p className={styles.muted}>Item · {record.entryTitle}</p>}{record.visitTitle&&<p className={styles.muted}>Visit · {record.visitTitle}</p>}
  {record.kind==='measurement'&&<>{record.dimensions?.length&&<DimensionReadout dimensions={record.dimensions.map(d=>({...d,verification:record.status==='verified'?'verified':record.status==='recheck'?'recheck':'unverified'}))} expanded showAll/>}{record.dimensions?.map(d=><p key={d.id} className={styles.muted}>{d.name} · {d.source==='client'?'Client supplied':'Team measured'}{d.evidence?` · ${d.evidence}`:''}</p>)}{record.reviewNote&&<p className={siteStyles.copy}><strong>Review</strong><br/>{record.reviewNote}</p>}{record.verifiedAt&&<p className={styles.muted}>Verified {new Date(record.verifiedAt).toLocaleString(locale)} · {record.recordedBy}</p>}</>}
  {record.note&&<p className={siteStyles.copy}>{record.note}</p>}{record.resolution&&<p className={siteStyles.copy}><strong>Resolution / follow-up</strong><br/>{record.resolution}</p>}
  <AssetFiles workspaceId={data.workspaceId} caseId={data.caseId} assets={record.assets}/>
  <p className={styles.muted}>{record.recordedBy?`Recorded by ${record.recordedBy}`:''}{record.updatedAt?` · ${new Date(record.updatedAt).toLocaleString(locale)}`:''}</p>
 </>;
}
function SiteHistory({record,data,onClose}:{record:SiteRecord;data:CaseContent;onClose:()=>void}) {
 const [history,setHistory]=useState<SiteRecord[]|null>(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;caseRequest<{items:SiteRecord[]}>(data.workspaceId,data.caseId,`site/${record.id}/history`).then(result=>{if(active)setHistory(result.items);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load history.');});return()=>{active=false;};},[data.workspaceId,data.caseId,record.id,attempt]);
 return <CaseModal title={`${record.title} · History`} description="Earlier records and evidence stay available after changes." onClose={onClose}>{error?<p role="alert" className={styles.error}>{error}<Button size="compact" onPress={()=>{setError('');setAttempt(n=>n+1);}}>Retry</Button></p>:!history?<p role="status" className={styles.muted}>Loading revisions…</p>:history.map(revision=><details className={siteStyles.history} key={revision.version}><summary>Revision {revision.version} · {siteLabels[revision.status]} · {revision.recordedBy}</summary><SiteRecordDetails record={revision} data={data}/></details>)}</CaseModal>;
}
function SiteReview({record,data,onClose,onSaved}:{record:SiteRecord;data:CaseContent;onClose:()=>void;onSaved:(record:SiteRecord)=>Promise<void>}) {
 const [status,setStatus]=useState(record.status==='verified'?'recheck':'verified');const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 return <CaseModal size="md" title="Review measurements" description={`${record.title} · Revision ${record.version}`} onClose={onClose} busy={busy} dirty={Boolean(note)} footer={<Button variant="primary" isLoading={busy} onPress={async()=>{if(!note.trim()){setError('Add a short review note.');return;}setBusy(true);setError('');try{await onSaved(await caseRequest<SiteRecord>(data.workspaceId,data.caseId,`site/${record.id}/review`,'POST',{version:record.version,status,note}));onClose();}catch(e){setError(e instanceof Error?e.message:'Could not save review.');}finally{setBusy(false);}}}>{status==='verified'?'Verify measurements':'Request recheck'}</Button>}>
  {error&&<p role="alert" className={styles.error}>{error}</p>}<DimensionReadout dimensions={record.dimensions??[]} expanded showAll/><AssetFiles workspaceId={data.workspaceId} caseId={data.caseId} assets={record.assets}/><div className={styles.captureFields}><SelectField label="Decision" isDisabled={busy} selectedKey={status} items={['verified','recheck'].filter(id=>id!==record.status).map(id=>({id,label:id==='verified'?'Measurements checked':'Recheck required'}))} onSelectionChange={key=>key&&setStatus(String(key))}/><label>Review note<textarea disabled={busy} value={note} maxLength={3000} rows={3} placeholder="What was checked, or what needs measuring again?" onChange={e=>setNote(e.target.value)}/></label><p className={styles.muted}>This records your review of these measurements and their evidence. Your name and the time are saved with the decision.</p></div>
 </CaseModal>;
}
