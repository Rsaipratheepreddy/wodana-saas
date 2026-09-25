"use client";
import {useState} from 'react';
import {Checkbox} from '@/design-system';
import type {DecisionEvidenceFile,ProjectData,ProjectState} from '@/lib/projects/execution';
import s from './project-workspace.module.css';
import styles from './project-decision-evidence.module.css';

export function DecisionEvidenceLinks({files,state}:{files?:DecisionEvidenceFile[];state:Pick<ProjectState,'id'|'workspaceId'>}) {
  if(!files?.length)return null;
  return <ul>{files.map(file=><li key={file.id}><a className={s.link} href={`/api/project-files/${state.id}/${file.id}?workspaceId=${state.workspaceId}`} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul>;
}

export function ProjectDecisionEvidence({state,recordId,selected,onChange,onData,busy,onBusy}:{state:ProjectState;recordId:string;selected:string[];onChange:(ids:string[])=>void;onData:(data:ProjectData)=>void;busy:boolean;onBusy:(value:boolean)=>void}) {
  const [error,setError]=useState('');
  const files=state.data.files?.filter(file=>file.recordId===recordId)??[];
  return <section className={styles.evidence} aria-label="Decision attachments">
    <strong>Photos / documents</strong>
    <div className={styles.files}>{files.map(file=><Checkbox key={file.id} isDisabled={busy} isSelected={selected.includes(file.id)} onChange={checked=>onChange(checked?[...selected,file.id]:selected.filter(id=>id!==file.id))}>{file.name}</Checkbox>)}</div>
    <label className={styles.upload}>Upload image or PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={async event=>{
      const input=event.currentTarget,file=input.files?.[0];if(!file)return;
      if(file.size>10*1024*1024){setError('Choose an image or PDF up to 10 MB.');input.value='';return;}
      onBusy(true);setError('');
      try {
        const body=new FormData();body.append('file',file);
        const response=await fetch(`/api/project-files/${state.id}/${crypto.randomUUID()}?workspaceId=${state.workspaceId}&recordId=${recordId}`,{method:'POST',body});
        const result=await response.json();
        if(!response.ok)throw new Error(result.message??'Upload failed. Retry this file.');
        if(!result.data||!result.file?.id)throw new Error('Upload response incomplete. Refresh Files before retrying.');
        onData(result.data);onChange([...new Set([...selected,result.file.id])]);
      }catch(error){setError(error instanceof Error?error.message:'Upload failed.');}
      finally{onBusy(false);input.value='';}
    }}/></label>
    <p className={s.muted}>Images or PDF, up to 10 MB. Selected files support this decision and remain internal.</p>
    {error&&<p role="alert" className={s.error}>{error}</p>}
  </section>;
}
