import Link from 'next/link';
import {Button} from '@/design-system';
import {label,taskProgress,type ProjectState} from '@/lib/projects/execution';
import type {WorkQueueRow} from '../../../../services/business-core/src/projects/project-work-queue';
import type {BoardTaskStatus} from './global-task-transition';
import s from './global-work-detail.module.css';

const value=(text?:string)=>text?.trim()||'—';
const date=(text?:string)=>{const day=text?.slice(0,10);return day&&/^\d{4}-\d{2}-\d{2}$/.test(day)?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`)):value(text);};
function Facts({items}:{items:[string,string|number][]}){return <dl className={s.facts}>{items.map(([name,detail])=><div key={name}><dt>{name}</dt><dd>{detail===''?'—':detail}</dd></div>)}</dl>}

/** A single read-only record surface for the cross-project queue. Editing stays with the source record. */
export function GlobalWorkDetail({row,state,onEdit,onProgress,onMove}:{row:WorkQueueRow;state:ProjectState;onEdit?:()=>void;onProgress?:()=>void;onMove?:(status:BoardTaskStatus)=>void}){
 const data=state.data;
 const task=row.kind==='task'?data.tasks.find(item=>item.id===row.recordId):undefined;
 const report=row.kind==='report'?data.reports.find(item=>item.id===row.recordId):undefined;
 const order=row.kind==='order'?data.orders.find(item=>item.id===row.recordId):undefined;
 const dispatch=row.kind==='dispatch'?data.dispatches?.find(item=>item.id===row.recordId):undefined;
 const snag=row.kind==='snag'?data.snags.find(item=>item.id===row.recordId):undefined;
 const handover=row.kind==='handover'?data.handovers.find(item=>item.id===row.recordId):undefined;
 const found=task||report||order||dispatch||snag||handover;
 if(!found)return <p role="alert">This record is no longer available. Refresh the board.</p>;
 const owner=(id?:string)=>state.members.find(member=>member.id===id)?.name||'Unassigned';
 const relatedReports=task?data.reports.filter(item=>item.entries.some(entry=>entry.taskId===task.id)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3):[];
 const workPackage=task?data.workPackages?.find(work=>work.id===task.packageId):undefined;
 const taskFiles=task?(data.files??[]).filter(file=>file.recordId===task.id):[];
 const taskComments=task?(data.comments??[]).filter(comment=>comment.recordId===task.id):[];
 const taskMaterials=task?(data.materials??[]).filter(material=>material.taskId===task.id):[];
 const packageReleased=Boolean(workPackage&&['ready','in_progress','completed'].includes(workPackage.status));
 const packageIssues=workPackage&&!packageReleased?state.connectedPlan?.packages.find(item=>item.id===workPackage.id)?.readinessIssues??[]:[];
 const taskChecks=task?[['Commercial release',Boolean(state.commercialReady)],['Work package released',packageReleased],['Scope',task.readiness.scope],['Site / workshop access',task.readiness.access],['Materials',task.readiness.materials],['Owner assigned',Boolean(task.ownerId)],['Approved drawing',task.location==='office'||(data.documents??[]).some(document=>document.id===task.drawingId&&document.status==='approved')]] as [string,boolean][]:[];
 return <div className={s.detail}>
  <div className={s.lead}><span>{({task:'Task',report:'Daily progress',order:'Procurement',dispatch:'Delivery',snag:'Defect',handover:'Handover'} as const)[row.kind]}</span><strong>{label(found.status)}</strong></div>
  <p className={s.project}>{state.name}{row.area?` · ${row.area}`:''}</p>
  {task&&<>
  {task.description&&<p className={s.summary}>{task.description}</p>}
   <Facts items={[["Work location",task.location==='site'?'On-site':label(task.location)],["Work package",value(workPackage?.title||task.package)],["Owner",owner(task.ownerId)],["Team / resource",value(state.resources.find(resource=>resource.id===task.resourceId)?.name)],["Start",date(task.start)],["Due",date(task.end)],["Priority",label(task.priority)],["Approved output",`${task.approved} / ${task.quantity} ${task.unit}`]]}/>
   <section className={s.section}><div className={s.sectionHeading}><h3>Planning → execution</h3><span>{workPackage?.status?label(workPackage.status):workPackage?'Status not set':'No package linked'}</span></div><p>{workPackage?.status==='planning'?'Finish the work-package checks before factory or site work can start.':workPackage&&!packageReleased?'This work package is not released for new factory or site work. Review its status and checks.':packageReleased?'This task follows the released work package through factory, site and daily progress.':'Link this task to a work package for a traceable handoff.'}</p><ul className={s.checkList}>{taskChecks.map(([name,ready])=><li key={name} data-ready={ready}><span aria-hidden="true">{ready?'✓':'○'}</span>{name}</li>)}</ul>{packageIssues.length>0&&<div className={s.packageIssues}><strong>Before release</strong><ul>{packageIssues.slice(0,3).map((issue,index)=><li key={`${issue.code}-${index}`}>{issue.detail}</li>)}</ul>{packageIssues.length>3&&<small>+{packageIssues.length-3} more checks in the work plan</small>}</div>}</section>
   {task.blocker&&<p className={s.alert}><strong>Blocked:</strong> {task.blocker}</p>}
   {task.predecessors.length>0&&<p className={s.note}>After {task.predecessors.map(id=>data.tasks.find(item=>item.id===id)?.title||'linked task').join(', ')}</p>}
   <section className={s.section}><div className={s.sectionHeading}><h3>{task.location==='factory'?'Factory output':task.location==='site'?'Installation':'Task output'}</h3><strong>{Math.round(taskProgress(data,task))}%</strong></div><progress className={s.progress} max={100} value={Math.round(taskProgress(data,task))} aria-label="Approved task progress"/><p>{task.factoryLots?.filter(lot=>lot.status!=='cancelled').length??0} production lots · {task.installationBatches?.filter(batch=>batch.status!=='cancelled').length??0} installation batches · {taskMaterials.length} materials</p></section>
   <section className={s.section}><h3>Daily progress</h3>{relatedReports.length?<ul>{relatedReports.map(item=><li key={item.id}><time dateTime={item.date}>{date(item.date)}</time><span>{item.summary||item.note||`${item.entries.find(entry=>entry.taskId===task.id)?.quantity??0} ${task.unit} recorded`}</span><small>{label(item.status)}</small></li>)}</ul>:<p>No daily progress linked yet.</p>}</section>
   <p className={s.note}>{taskComments.length} comments · {taskFiles.length} files · {(data.audit??[]).filter(event=>event.recordId===task.id).length} history entries. Open task details to discuss, attach evidence or review changes.</p>
  </>}
  {report&&<><Facts items={[["Date",date(report.date)],["Location",report.location==='site'?'On-site':'Factory'],["Shift",value(report.shift)],["Reported by",value(report.author)],["People",report.people],["Hours",report.hours],["Schedule impact",label(report.scheduleImpact||'none')]]}/><p className={s.summary}>{report.summary||report.note||'No summary recorded.'}</p><section className={s.section}><h3>Work reported</h3>{report.entries.length?<ul>{report.entries.map(entry=><li key={entry.taskId}><span>{data.tasks.find(item=>item.id===entry.taskId)?.title||'Linked task'}</span><strong>{entry.quantity}</strong></li>)}</ul>:<p>No task quantities recorded.</p>}</section>{report.issues&&<p className={s.alert}><strong>Issues:</strong> {report.issues}</p>}{report.tomorrow&&<p className={s.note}><strong>Next:</strong> {report.tomorrow}</p>}</>}
  {order&&<><Facts items={[["Reference",value(order.number)],["Supplier",value(order.vendor)],["Kind",label(order.kind)],["Quantity",`${order.quantity} ${order.unit}`],["Promised",date(order.promisedDate)],["Receipts",order.receipts.length]]}/>{order.notes&&<p className={s.summary}>{order.notes}</p>}</>}
  {dispatch&&<><Facts items={[["Destination",value(dispatch.destination)],["Quantity",`${dispatch.quantity} ${dispatch.unit}`],["Due",date(dispatch.dueDate)],["Carrier",value(dispatch.carrier)],["Reference",value(dispatch.reference)],["Accepted",`${dispatch.accepted} ${dispatch.unit}`]]}/><p className={s.note}>Linked work: {data.tasks.find(item=>item.id===dispatch.taskId)?.title||'—'}</p></>}
  {snag&&<><Facts items={[["Area",value(snag.area)],["Severity",label(snag.severity)],["Owner",owner(snag.ownerId)],["Due",date(snag.dueDate)],["Linked task",data.tasks.find(item=>item.id===snag.taskId)?.title||'—']]}/>{snag.resolution&&<p className={s.summary}>{snag.resolution}</p>}</>}
  {handover&&<><Facts items={[["Area",value(handover.area)],["Tasks",handover.taskIds.length],["Documents",handover.documentIds.length],["Accepted by",value(handover.acceptedBy)],["Accepted on",date(handover.acceptedAt)]]}/>{handover.outstanding&&<p className={s.alert}><strong>Outstanding:</strong> {handover.outstanding}</p>}</>}
  <div className={s.actions}>{onEdit&&<Button size="compact" onPress={onEdit}>Open task details</Button>}{onMove&&task&&['planned','blocked','on_hold'].includes(task.status)&&<Button size="compact" variant="primary" onPress={()=>onMove('in_progress')}>Start / resume work</Button>}{onMove&&task&&task.status==='in_progress'&&<Button size="compact" onPress={()=>onMove('blocked')}>Block task</Button>}{onProgress&&<Button size="compact" variant="primary" onPress={onProgress}>Log daily progress</Button>}<Link href={row.href}>Open full record in project ↗</Link></div>
 </div>;
}
