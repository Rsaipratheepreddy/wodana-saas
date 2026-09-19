import {useEffect,useRef,useState} from 'react';
import {AppState,View} from 'react-native';
import {Text} from '../design-system';
import {useAuth} from '../auth/provider';
import {sitePayload,usePreProjectApi} from './api';
import {fieldSyncFailure,queueSummary,syncFieldSave,type PendingFieldSave} from './field-queue';
import {fieldMediaForm,readFieldQueue,removeFieldQueue,writeFieldQueue} from './pending-field';
import {Button,NoteCard,Notice} from './ui';

const stateLabel:Record<PendingFieldSave['state'],string>={pending:'Waiting to sync',syncing:'Sync interrupted',conflict:'Revision changed',permission:'Access changed',invalid:'Needs correction'};

export function FieldQueuePanel({workspaceId,caseId,revision,onSynced,onReview}:{workspaceId:string;caseId:string;revision:number;onSynced:()=>void;onReview:(operation:PendingFieldSave)=>void}){
 const {state}=useAuth();const api=usePreProjectApi(workspaceId,caseId);const userId=state.status==='signedIn'?state.profile.id:'';const [rows,setRows]=useState<PendingFieldSave[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const auto=useRef('');
 const reload=async()=>{if(!userId)return;try{setRows(await readFieldQueue(userId,workspaceId,caseId));}catch(e){setError(e instanceof Error?e.message:'The field queue could not be read.');}};
 async function sync(row:PendingFieldSave){let current=row;try{await syncFieldSave(row,sitePayload,{upload:async media=>{const upload=await fieldMediaForm(media);try{return await api(`assets/${media.id}`,'POST',upload.form);}finally{upload.cleanup();}},save:(path,body)=>api(path,'PUT',body),checkpoint:async next=>{current=next;await writeFieldQueue(next);}});await removeFieldQueue(current);onSynced();return true;}catch(e){const failure=fieldSyncFailure(e);await writeFieldQueue({...current,state:failure.state,error:failure.message,updatedAt:Date.now()});return false;}}
 async function retry(){if(busy)return;setBusy(true);setError('');try{const current=await readFieldQueue(userId,workspaceId,caseId);for(const row of current.filter(item=>item.state==='pending'||item.state==='syncing'))await sync(row);await reload();}catch(e){setError(e instanceof Error?e.message:'The field queue could not be synced.');}finally{setBusy(false);}}
 useEffect(()=>{void reload();},[userId,workspaceId,caseId,revision]);
 useEffect(()=>{const key=`${userId}:${workspaceId}:${caseId}:${revision}`;if(!userId||auto.current===key||!rows.some(row=>row.state==='pending'||row.state==='syncing'))return;auto.current=key;void retry();},[rows,userId,workspaceId,caseId,revision]);
 useEffect(()=>{const subscription=AppState.addEventListener('change',next=>{if(next==='active')void retry();});return()=>subscription.remove();},[userId,workspaceId,caseId,busy]);
 if(!rows.length&&!error)return null;const summary=queueSummary(rows);
 return <View style={{gap:10}}>{error&&<Notice error>{error}</Notice>}<Notice>{summary.pending?`${summary.pending} field draft${summary.pending===1?' is':'s are'} waiting to sync. `:''}{summary.attention?`${summary.attention} need${summary.attention===1?'s':''} review. Local evidence is retained.`:'Evidence uploads resume automatically with the same file IDs.'}</Notice>{summary.pending>0&&<Button label="Retry field sync" variant="secondary" loading={busy} disabled={busy} onPress={()=>void retry()}/>} {rows.map(row=><NoteCard key={row.id} title={row.record.title||'Untitled field draft'} meta={`${stateLabel[row.state]} · ${row.media.filter(media=>!media.uploaded).length} file${row.media.filter(media=>!media.uploaded).length===1?'':'s'} remaining`} note={row.error||'Stored on this device.'} onPress={()=>onReview(row)}><Text size="xs" tone="textSecondary">Open local draft</Text></NoteCard>)}</View>;
}
