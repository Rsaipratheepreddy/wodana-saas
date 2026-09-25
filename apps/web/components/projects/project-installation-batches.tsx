"use client";
import {StateBadge} from './project-stage';
import {Button} from '@/design-system';
import type {ProjectState,Task} from '@/lib/projects/execution';
import {DecisionEvidenceLinks} from './project-decision-evidence';
import c from './project-order-detail.module.css';
export function ProjectInstallationBatches({state,task,busy,onCreate,onReview,onCancel}:{state:ProjectState;task:Task;busy:boolean;onCreate:()=>void;onReview:(id:string,passed:boolean)=>void;onCancel:(id:string)=>void}) {
 const factory=task.location==='factory';
 const title=factory?'Production lots':'Installation batches';
 const batches=(factory?task.factoryLots:task.installationBatches)??[];
 if(!['site','factory'].includes(task.location) || (!task.approved && !batches.length))return null;
 const allocated=batches.filter(b=>b.status!=='cancelled').reduce((total,b)=>total+b.quantity,0);
 const canCreate=(state.canManage||(state.canReport&&(task.ownerId===state.memberId||task.assigneeIds.includes(state.memberId)))) && !['cancelled','on_hold','blocked'].includes(task.status) && !state.data.tasks.some(child=>child.parentId===task.id) && !(factory&&(task.inspections?.length||(state.data.dispatches??[]).some(dispatch=>dispatch.taskId===task.id&&!dispatch.factoryLotId&&dispatch.status!=='cancelled')));
 return <section className={c.detail}><div className={c.top}><strong>{title}</strong>{canCreate&&task.approved>allocated&&<Button size="compact" isDisabled={busy} onPress={onCreate}>{factory?'Create lot':'Create batch'}</Button>}</div>
 {batches.length>0&&<div className={c.scroll}><table aria-label={title}><thead><tr><th>Batch</th><th>Quantity</th><th>QC</th><th>Evidence</th><th>Action</th></tr></thead><tbody>{batches.map(batch=><tr key={batch.id}><td>{batch.title}</td><td>{batch.quantity} {batch.unit}</td><td><StateBadge state={batch.status}/></td><td>{batch.reviews.map((review,index)=><div key={index}>{review.passed?'Passed':'Rework'} · {review.evidence}<DecisionEvidenceLinks files={review.evidenceFiles} state={state}/></div>)}</td><td>{['pending_qc','rework'].includes(batch.status)&&<div className={c.links}>{state.canReview&&batch.createdBy!==state.memberId&&task.ownerId!==state.memberId&&!task.assigneeIds.includes(state.memberId)&&<><Button size="compact" isDisabled={busy} onPress={()=>onReview(batch.id,true)}>Pass QC</Button><Button size="compact" isDisabled={busy} onPress={()=>onReview(batch.id,false)}>Rework</Button></>}{state.canManage&&<Button size="compact" isDisabled={busy} onPress={()=>onCancel(batch.id)}>{factory?'Cancel lot':'Cancel batch'}</Button>}</div>}</td></tr>)}</tbody></table></div>}
 </section>;
}
