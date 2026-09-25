"use client";
import {useEffect,useRef,useState} from 'react';
import {Button,ControlledModalDialog,TextAreaField} from '@/design-system';
import {jsonRequest} from '@/lib/commercial/client';
import {projectPath,type ProjectState,type ProjectData} from '@/lib/projects/execution';
import type {WorkQueueRow} from '../../../../services/business-core/src/projects/project-work-queue';
export type BoardTaskStatus='planned'|'in_progress'|'blocked';
const labels={planned:'To do',in_progress:'In progress',blocked:'Blocked'};
export function GlobalTaskTransition({workspaceId,row,status,onClose,onSaved}:{workspaceId:string;row:WorkQueueRow;status:BoardTaskStatus;onClose:()=>void;onSaved:(state:ProjectState)=>void}){
 const [state,setState]=useState<ProjectState|null>(null),[note,setNote]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0);
 const retry=useRef<{body:string;id:string}|null>(null);
 useEffect(()=>{let active=true;setLoading(true);setState(null);void jsonRequest<ProjectState>(projectPath(workspaceId,`${row.projectId}/execution`)).then(state=>{if(active){setState(state);setError('');}}).catch(error=>{if(active)setError((error as Error).message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[workspaceId,row.projectId,attempt]);
 async function save(){
  if(!state||saving)return;setError('');
  if(status==='blocked'&&!note.trim()){setError('Enter the reason for blocking this task.');return;}
  const task=state.data.tasks.find(task=>task.id===row.recordId);
  if(!task||['completed','cancelled','awaiting_inspection'].includes(task.status)){setError('This task changed. Review its progress or inspection before moving it.');return;}
  const input={action:'task_status',id:row.recordId,status,note,revision:state.data.revision};
  const body=JSON.stringify(input);if(retry.current?.body!==body)retry.current={body,id:crypto.randomUUID()};
  setSaving(true);
  try{const result=await jsonRequest<{data:ProjectData}>(projectPath(workspaceId,`${row.projectId}/execution`),'POST',{...input,requestId:retry.current.id});if(!result.data)throw Error('The response was incomplete. Refresh to verify this task.');onSaved({...state,data:result.data});}
  catch(error){setError((error as Error).message);}finally{setSaving(false);}
 }
 return <ControlledModalDialog isOpen title={`Move task to ${labels[status]}`} isDismissable={!saving} onOpenChange={open=>!open&&!saving&&onClose()} footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button variant="primary" isDisabled={loading||!state?.canManage} isLoading={saving} onPress={()=>void save()}>Move task</Button></div>}>
  <p><strong>{row.title}</strong> · {row.projectName}</p><p>Readiness, dependencies, approvals and resource bookings are checked before work can start. Moving a card does not approve output or complete an inspection.</p>
  {loading&&<p role="status">Checking current task…</p>}{error&&<><p role="alert">{error}</p><Button isDisabled={saving} size="compact" onPress={()=>setAttempt(value=>value+1)}>Refresh task before retry</Button></>}
  <TextAreaField label={status==='blocked'?'Blocker / reason':'Reason / note'} isRequired={status==='blocked'} value={note} onChange={setNote} isDisabled={saving} maxLength={3000}/>
 </ControlledModalDialog>;
}
