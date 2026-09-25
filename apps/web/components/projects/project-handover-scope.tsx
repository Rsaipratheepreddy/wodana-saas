"use client";
import type { Handover, ProjectState, Task } from "@/lib/projects/execution";
import c from "./project-order-detail.module.css";
import {DecisionEvidenceLinks} from './project-decision-evidence';

export function ProjectHandoverScope({handover, state}:{handover:Handover;state:ProjectState}) {
  const packet=handover.packet;
  const tasks=packet?.tasks ?? state.data.tasks.filter(task=>handover.taskIds.includes(task.id)).map(task=>({...task,quantity:handover.installationBatchIds?.length?(task.installationBatches??[]).filter(batch=>handover.installationBatchIds!.includes(batch.id)).reduce((total,batch)=>total+batch.quantity,0):task.quantity}));
  return <div className={c.detail}>
    <DecisionEvidenceLinks files={handover.acceptanceFiles} state={state}/>
    <strong>{packet?`Reviewed pack · Version ${packet.version}`:"Scope preview · Not prepared"}</strong>
    <div className={c.scroll}><table aria-label="Handover scope"><thead><tr><th>Work</th><th>Area</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>{tasks.map(task=><tr key={task.id}><td>{task.title}</td><td>{task.area}</td><td><strong>{task.quantity}</strong></td><td>{task.unit}</td></tr>)}</tbody></table></div>
    {packet && <div className={c.scroll}><table aria-label="Handover documents"><thead><tr><th>Document</th><th>Revision</th><th>Type</th></tr></thead><tbody>{packet.documents.map(document=><tr key={document.id}><td>{document.title}</td><td>{document.revision}</td><td>{document.kind.replaceAll('_',' ')}</td></tr>)}</tbody></table></div>}
  </div>;
}

export function ProjectInspectionHistory({task,state}:{task:Task;state:ProjectState}) {
  if(!task.inspections?.length)return null;
  return <div className={c.detail}><div className={c.scroll}><table aria-label="Inspection history"><thead><tr><th>Decision</th><th>Quantity</th><th>Reviewer</th><th>Date</th><th>Evidence</th></tr></thead><tbody>{task.inspections.map(inspection=><tr key={inspection.id}><td><strong>{inspection.passed?"Passed":"Correction required"}</strong></td><td>{inspection.quantity} {inspection.unit}</td><td>{state.members.find(member=>member.id===inspection.by)?.name??"Reviewer"}</td><td>{inspection.at.slice(0,10)}</td><td>{inspection.evidence}<DecisionEvidenceLinks files={inspection.evidenceFiles} state={state}/></td></tr>)}</tbody></table></div></div>;
}
