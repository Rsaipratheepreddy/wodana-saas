"use client";
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { parseDateTime, today } from '@internationalized/date';
import { Button, ComboboxField, DateField, SelectField } from '@/design-system';
import { type CaseContent, type CaseRoom, type ItemDimension } from '@/lib/pre-project/content';
import { type SiteData, type SiteRecord, siteLabel, visitInstant, visitWallTime } from '@/lib/pre-project/site';
import { AssetFiles, AssetUpload, CaseModal } from './case-controls';
import { RoomField } from './room-manager';
import styles from './case-content.module.css';
import siteStyles from './site.module.css';
import { useT } from '@/lib/i18n/i18n-provider';

export function SiteRecordEditor({initial,data:initialData,site,onClose,onSave,onRoomAdded}:{initial:SiteRecord;data:CaseContent;site:SiteData;onClose:()=>void;onSave:(record:SiteRecord,specificationVersion:number)=>Promise<void>;onRoomAdded?:(room:CaseRoom)=>void}) {
 const t=useT();
 const [rooms,setRooms]=useState(initialData.rooms);const data={...initialData,rooms};
 const [draft,setDraft]=useState(initial);const [step,setStep]=useState(0);const [error,setError]=useState('');const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState(false);
 const [localTime,setLocalTime]=useState(()=>visitWallTime(initial.scheduledAt,initial.timezone??site.timezone));
 const [timezoneSearch,setTimezoneSearch]=useState(initial.timezone??site.timezone);
 const [unitNotice,setUnitNotice]=useState('');
 const measurement=draft.kind==='measurement';const visit=draft.kind==='visit';
 const steps=measurement?[t('Location'),t('Dimensions'),t('Evidence')]:visit?[t('Schedule'),t('Access & outcome')]:[t('Observation'),t('Photos & follow-up')];
 const disabled=saving||uploading||!data.canEdit||Boolean(initial.entryArchivedAt);
 const dirty=JSON.stringify(draft)!==JSON.stringify(initial)||localTime!==visitWallTime(initial.scheduledAt,initial.timezone??site.timezone);
 const change=(patch:Partial<SiteRecord>)=>setDraft(d=>({...d,...patch}));
 const activeItems=data.entries.filter(e=>e.kind==='requirement'&&(!e.archivedAt||e.id===draft.entryId)&&(draft.roomId===null||e.roomId===draft.roomId));
 const selectedEntry=data.entries.find(e=>e.id===draft.entryId);
 const updateDimension=(id:string,patch:Partial<ItemDimension>)=>setDraft(d=>({...d,dimensions:d.dimensions?.map(dim=>dim.id===id?{...dim,...patch}:dim)}));
 const validate=(all=false)=>{
  if(!draft.title.trim()){setStep(0);setError(t(visit?'Give the visit a short title.':'Enter a short title.'));return false;}
  if(measurement&&!draft.roomId&&!draft.entryId){setStep(0);setError(t('Choose a room or scope item to measure.'));return false;}
  if(visit){try{visitInstant(localTime,draft.timezone??site.timezone);}catch{setStep(0);setError(t('Choose a valid date, time and time zone. This local time may be unavailable or ambiguous during a clock change.'));return false;}}
  if(measurement&&(all||step===1)&&(!draft.dimensions?.length||draft.dimensions.some(d=>!d.name.trim()||(d.measured==null&&d.approximate==null)||[d.measured,d.approximate].some(n=>n!=null&&(!Number.isFinite(n)||n<=0||n>1e6))))){setStep(1);setError(t('Add a named dimension with an approximate or measured value greater than zero.'));return false;}
  if(all&&visit&&draft.status!=='planned'&&!draft.outcome?.trim()){setStep(1);setError(t('Add an outcome or cancellation reason.'));return false;}
  if(all&&!visit&&!measurement&&draft.status==='resolved'&&!draft.resolution?.trim()){setStep(1);setError(t('Add a resolution note.'));return false;}
  setError('');return true;
 };
 const navigate=(next:number)=>{if(next>step&&!validate())return;setStep(next);};
 const save=async()=>{if(!validate(true))return;setSaving(true);try{await onSave({...draft,...(visit?{scheduledAt:visitInstant(localTime,draft.timezone??site.timezone)}:{})},selectedEntry?.specification?.version??0);onClose();}catch(e){setError(e instanceof Error?e.message:t('Could not save.'));}finally{setSaving(false);}};
 const text=(label:string,key:'title'|'location'|'access'|'note'|'outcome'|'resolution',multiline=false,max=3000)=><label>{label}{multiline?<textarea disabled={disabled} rows={3} maxLength={max} value={String(draft[key]??'')} onChange={e=>change({[key]:e.target.value})}/>:<input disabled={disabled} maxLength={max} value={String(draft[key]??'')} onChange={e=>change({[key]:e.target.value})}/>}</label>;
 const locations=<>
  <RoomField data={data} isDisabled={disabled||(measurement&&initial.version>0)} value={draft.roomId??null} onRoomAdded={room=>{setRooms(r=>[...r,room]);onRoomAdded?.(room);}} onChange={room=>change({roomId:room.id,entryId:null,...(measurement?{dimensions:[]}: {})})}/>
  <ComboboxField label={t('Scope item · optional')} placeholder={t('Choose an existing item…')} isDisabled={disabled||(measurement&&initial.version>0)} selectedKey={draft.entryId} items={activeItems.map(e=>({id:e.id,label:`${e.title}${e.roomName?` · ${e.roomName}`:''}`}))} onSelectionChange={key=>{const e=data.entries.find(item=>item.id===key);if(e)change({entryId:e.id,roomId:e.roomId,...(measurement?{title:e.title,dimensions:e.specification?.dimensions??[]}: {})});}}/>
  {draft.entryId&&!(measurement&&initial.version>0)&&<Button size="compact" variant="quiet" isDisabled={disabled} onPress={()=>change({entryId:null,...(measurement?{dimensions:[]}: {})})}>{t('Clear item · measure room instead')}</Button>}
 </>;
 return <CaseModal size={measurement?'lg':'md'} title={initial.version?t(visit?'Edit site visit':measurement?'Edit measurements':'Edit observation'):t(visit?'Add site visit':measurement?'Add measurements':'Add observation')} description={t(measurement?'Record the actual space. Keep the original estimates alongside.':visit?'Schedule a survey and record what the team needs to check.':'Capture what the team found at the property.')} onClose={onClose} dirty={dirty} busy={saving||uploading} footer={<div className={styles.stepFooter}>{step>0&&<Button size="compact" isDisabled={saving||uploading} onPress={()=>navigate(step-1)}>{t('Back')}</Button>}{step<steps.length-1&&<Button size="compact" isDisabled={saving||uploading} onPress={()=>navigate(step+1)}>{t('Continue')}</Button>}{data.canEdit&&!initial.entryArchivedAt&&<Button size="compact" variant="primary" isLoading={saving} isDisabled={uploading} onPress={save}>{t(measurement?'Save measurements':visit?'Save visit':'Save observation')}</Button>}</div>}>
  <nav className={styles.stepper} aria-label={t('Site form steps')}><ol>{steps.map((label,index)=><li key={label}><button type="button" aria-current={step===index?'step':undefined} disabled={saving||uploading} onClick={()=>navigate(index)}><span className={styles.stepNumber}>{index+1}</span>{label}</button></li>)}</ol></nav>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  <div className={styles.captureFields}>
   {step===0&&<>
    {text(t(visit?'Visit title':measurement?'What are you measuring?':'Observation'), 'title',false,240)}
    {visit?<><div className={styles.grid}><DateField firstDayOfWeek={(['sun','mon','tue','wed','thu','fri','sat'] as const)[site.weekStartsOn??1]} label={t('Date & time')} placeholderValue={parseDateTime(`${today(draft.timezone??site.timezone)}T10:00`)} granularity="minute" hourCycle={24} isDisabled={disabled} value={localTime?parseDateTime(localTime):null} onChange={value=>setLocalTime(value?.toString()??'')}/><label>{t('Duration (minutes)')}<input type="number" disabled={disabled} min={15} max={1440} step={15} value={draft.durationMinutes??60} onChange={e=>change({durationMinutes:Number(e.target.value)})}/></label></div><ComboboxField label={t('Time zone')} isDisabled={disabled} selectedKey={draft.timezone??site.timezone} inputValue={timezoneSearch} onInputChange={setTimezoneSearch} items={[...new Set([draft.timezone??site.timezone,'UTC',...Intl.supportedValuesOf('timeZone').filter(z=>z.toLowerCase().includes(timezoneSearch.toLowerCase())).slice(0,50)])].map(id=>({id,label:id}))} onSelectionChange={key=>{if(key){change({timezone:String(key)});setTimezoneSearch(String(key));}}}/><SelectField label={t('Assigned to')} isDisabled={disabled} selectedKey={draft.assigneeId??'none'} items={[{id:'none',label:t('Unassigned')},...site.members.map(m=>({id:m.id,label:m.name})),...(draft.assigneeId&&!site.members.some(m=>m.id===draft.assigneeId)?[{id:draft.assigneeId,label:t('{name} · unavailable',{name:draft.assigneeName??t('Former member')})}]:[])]} onSelectionChange={key=>key&&change({assigneeId:key==='none'?null:String(key)})}/>{text(t('Purpose / what to check'),'note',true,6000)}</>:<>{locations}{!measurement&&<><SelectField label={t('Category')} isDisabled={disabled} selectedKey={draft.category} items={['condition','opening','electrical','plumbing','access','constraint','other'].map(id=>({id,label:siteLabel(t,id)}))} onSelectionChange={key=>key&&change({category:String(key)})}/>{text(t('What did you find?'),'note',true,6000)}</>}</>}
   </>}
   {measurement&&step===1&&<>
    <p className={styles.muted}>{selectedEntry?.title??data.rooms.find(r=>r.id===draft.roomId)?.name} · {t('Enter each dimension with its own unit and basis.')}</p>
    {unitNotice&&<p role="status" className={styles.notice}>{unitNotice}</p>}
    {draft.dimensions?.map((dim,index)=><section className={siteStyles.dimensionEditor} key={dim.id} aria-label={t('Dimension {number}',{number:index+1})}>
     <div className={siteStyles.dimensionTitle}><label>{t('Dimension name')}<input disabled={disabled} maxLength={120} value={dim.name} placeholder={t('Width, ceiling height, opening…')} onChange={e=>updateDimension(dim.id,{name:e.target.value})}/></label><Button size="compact" variant="quiet" isDisabled={disabled} aria-label={t('Remove dimension {number}',{number:index+1})} onPress={()=>change({dimensions:draft.dimensions?.filter(d=>d.id!==dim.id)})}><Trash2 size={14}/></Button></div>
     <div className={siteStyles.dimensionValues}>{(['approximate','measured'] as const).map(key=><label key={key}>{t(key==='approximate'?'Approximate':'Measured')}<input disabled={disabled} type="number" min="0.0001" max="1000000" step="0.0001" value={dim[key]??''} onChange={e=>updateDimension(dim.id,{[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}<SelectField label={t('Unit')} isDisabled={disabled} selectedKey={dim.unit} items={['mm','cm','m','in','ft'].map(id=>({id,label:id}))} onSelectionChange={key=>{if(key&&key!==dim.unit){updateDimension(dim.id,{unit:String(key),approximate:null,measured:null});setUnitNotice(t('Unit changed. Re-enter the values in the selected unit.'));}}}/></div>
     <div className={styles.grid}><SelectField label={t('Basis')} isDisabled={disabled} selectedKey={dim.basis} items={[{id:'site_opening',label:t('Site opening / available space')},{id:'finished_item',label:t('Finished item')},{id:'fabrication',label:t('Fabrication / cut size')}]} onSelectionChange={key=>key&&updateDimension(dim.id,{basis:String(key)})}/><SelectField label={t('Measured by')} isDisabled={disabled} selectedKey={dim.source} items={[{id:'team',label:t('Our team')},{id:'client',label:t('Client supplied')}]} onSelectionChange={key=>key&&updateDimension(dim.id,{source:String(key)})}/></div>
     <label>{t('Reference / measurement note · optional')}<input disabled={disabled} maxLength={2000} value={dim.evidence} onChange={e=>updateDimension(dim.id,{evidence:e.target.value})}/></label>
    </section>)}
    {data.canEdit&&<Button size="compact" isDisabled={disabled||(draft.dimensions?.length??0)>=40} onPress={()=>change({dimensions:[...(draft.dimensions??[]),{id:crypto.randomUUID(),name:'',unit:'mm',basis:'site_opening',approximate:null,measured:null,source:'team',evidence:''}]})}><Plus size={14}/>{t('Add dimension')}</Button>}
   </>}
   {step===steps.length-1&&<>
    {visit?<>{text(t('Site address / meeting point'),'location',false,1000)}{text(t('Access, contact and working-hour instructions'),'access',true)}<SelectField label={t('Visit status')} isDisabled={disabled} selectedKey={draft.status} items={['planned','completed','cancelled'].map(id=>({id,label:siteLabel(t,id)}))} onSelectionChange={key=>key&&change({status:String(key)})}/>{text(t(draft.status==='cancelled'?'Cancellation reason':'Outcome / next steps'),'outcome',true)}</>:<><SelectField label={t('Related visit · optional')} isDisabled={disabled} selectedKey={draft.visitId??'none'} items={[{id:'none',label:t('No visit linked')},...site.items.filter(r=>r.kind==='visit').map(r=>({id:r.id,label:r.title}))]} onSelectionChange={key=>key&&change({visitId:key==='none'?null:String(key)})}/>{measurement?text(t('Survey notes / what to recheck'),'note',true,6000):<><SelectField label={t('Status')} isDisabled={disabled} selectedKey={draft.status} items={['open','resolved'].map(id=>({id,label:siteLabel(t,id)}))} onSelectionChange={key=>key&&change({status:String(key)})}/>{(draft.status==='resolved'||draft.resolution)&&text(t('Resolution / follow-up note'),'resolution',true)}</>}</>}
    <AssetFiles workspaceId={data.workspaceId} caseId={data.caseId} assets={draft.assets} onMarked={!disabled?asset=>change({assets:[...draft.assets,asset]}):undefined} onRemove={!disabled?id=>change({assets:draft.assets.filter(a=>a.id!==id)}):undefined}/>
    {data.canEdit&&<AssetUpload currentCount={draft.assets.length} workspaceId={data.workspaceId} caseId={data.caseId} disabled={disabled||draft.assets.length>=20} onBusy={setUploading} onError={setError} onUploaded={asset=>setDraft(d=>({...d,assets:[...d.assets,asset]}))}/>}
    {measurement&&<p className={styles.muted}>{t('Save partial measurements now. Verification requires every measured value and supporting photos or a PDF.')}</p>}
   </>}
  </div>
 </CaseModal>;
}
