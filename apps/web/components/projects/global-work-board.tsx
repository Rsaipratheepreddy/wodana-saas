"use client";
import Link from 'next/link';
import {CalendarDays,Factory,FolderKanban,MapPin,UsersRound} from 'lucide-react';
import {Avatar,IconMenuButton} from '@/design-system';
import {useState} from 'react';
import type {BoardTaskStatus} from './global-task-transition';
import type {WorkQueueRow} from '../../../../services/business-core/src/projects/project-work-queue';
import {StateBadge} from './project-stage';
import s from './global-work-board.module.css';
const columns=[['planned','To do'],['active','In progress'],['review','Review'],['done','Done']] as const;
const sourceNames={task:'Task',report:'Progress',order:'Order',dispatch:'Delivery',snag:'Snag',handover:'Handover'};
const shortDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`)):date;
const projectDisplayName=(name:string)=>name.replace(/^DEMO FLOW\s*·\s*/i,'').replace(/\s+—\s+Design to Delivery$/i,'').trim();
const orderReference=(row:Pick<WorkQueueRow,'kind'|'title'>)=>row.kind==='order'?row.title.match(/^((?:RFQ|PO)-[A-Z0-9-]+)\s*·\s*/i)?.[1]||'':'';
const cardHref=(row:WorkQueueRow)=>row.kind==='task'?`/workspace/tasks?projectId=${encodeURIComponent(row.projectId)}&taskId=${encodeURIComponent(row.recordId)}`:row.href;
const visibleTaskTitle=(row:Pick<WorkQueueRow,'kind'|'title'|'location'>)=>{
 let title=row.title;
 const separator=title.indexOf(' · ');
 if(separator>0&&row.location&&title.slice(0,separator).trim().toLowerCase()===row.location.trim().toLowerCase())title=title.slice(separator+3).trim();
 const daily=title.match(/^Daily output\s*·\s*(\d{4}-\d{2}-\d{2})$/i);
 if(row.kind==='report'&&daily)return `Daily progress report for ${shortDate(daily[1])}`;
 const reference=orderReference(row);
 if(reference)title=title.slice(title.indexOf(' · ')+3).replace(/^DEMO\s*·\s*/i,'').trim();
 if(row.kind==='handover'&&title.startsWith('Handover · '))return `Handover for ${title.slice('Handover · '.length)}`;
 return title.replace(/\s+·\s+/g,': ');
};
export function workLane(row:Pick<WorkQueueRow,'kind'|'status'>){
 if(['blocked','on_hold','returned','rejected','rework'].includes(row.status))return 'active';
 if(['completed','closed','cancelled','withdrawn'].includes(row.status)||(row.kind==='report'&&row.status==='approved')||(row.kind==='dispatch'&&row.status==='received')||(row.kind==='handover'&&row.status==='accepted'))return 'done';
 if(['submitted','in_review','awaiting_inspection','pending_qc','resolved','ready'].includes(row.status))return 'review';
 if(['in_progress','approved','acknowledged','dispatched'].includes(row.status))return 'active';
 return 'planned';
}
export function GlobalWorkBoard({rows,busy,error,hasMore,onOpenTask,onMoveTask}:{rows:WorkQueueRow[];busy:boolean;error:string;hasMore:boolean;onOpenTask?:(row:WorkQueueRow,tab?:string)=>void;onMoveTask?:(row:WorkQueueRow,status:BoardTaskStatus)=>void}){
 const [dragging,setDragging]=useState('');
 const [dropTarget,setDropTarget]=useState('');
 const moves:Record<string,BoardTaskStatus>={planned:'planned',active:'in_progress'};
 const movable=(row:WorkQueueRow)=>!!onMoveTask&&row.kind==='task'&&!['completed','cancelled','awaiting_inspection'].includes(row.status);
 const canDrag=(row:WorkQueueRow)=>!busy&&row.kind==='task'&&(movable(row)||!!onOpenTask&&['in_progress','awaiting_inspection'].includes(row.status));
 const canDrop=(row:WorkQueueRow,lane:string)=>{
  if(busy||row.kind!=='task')return false;
  if(lane==='review')return row.status==='in_progress'&&!!onOpenTask;
  if(lane==='done')return row.status==='awaiting_inspection'&&!!onOpenTask;
  return movable(row)&&!!moves[lane]&&row.status!==moves[lane];
 };
 return <>
  {hasMore&&<p className={s.notice}>Showing loaded work. Load more to include the remaining cards.</p>}
  <div className={s.board} role="region" aria-label="Project work Kanban" tabIndex={0} aria-busy={busy}>
   {columns.map(([id,title])=>{const cards=rows.filter(row=>workLane(row)===id);return <section className={s.column} key={id} aria-labelledby={`global-work-${id}`} data-empty={!cards.length||undefined} data-state={id} data-drop-target={dropTarget===id||undefined} onDragOver={event=>{const row=rows.find(row=>row.id===dragging);if(row&&canDrop(row,id)){event.preventDefault();event.dataTransfer.dropEffect='move';setDropTarget(id);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropTarget('');}} onDrop={event=>{event.preventDefault();const row=rows.find(row=>row.id===(event.dataTransfer.getData('text/plain')||dragging));setDragging('');setDropTarget('');if(!row||!canDrop(row,id))return;if(id==='review')onOpenTask?.(row,'updates');else if(id==='done')onOpenTask?.(row,'details');else onMoveTask?.(row,moves[id]);}}>
    <header className={s.heading}><h2 id={`global-work-${id}`}><i aria-hidden="true"/>{title}</h2><span data-pending={cards.length>0&&id!=="done"||undefined} aria-label={`${cards.length} loaded items`}>{cards.length}</span></header>
    {dropTarget===id&&<p className={s.dropHint}>{id==='review'?'Drop to report progress':id==='done'?'Drop to review inspection':'Drop to move task'}</p>}
    {cards.length?<div className={s.cards}>{cards.map(row=>{const menuItems=row.kind==='task'?[...(onOpenTask?[{id:'edit',label:'Update task'},...(!['completed','cancelled'].includes(row.status)?[{id:'updates',label:'Log progress'}]:[]),{id:'comments',label:'Discuss'}]:[]),...Object.entries(moves).filter(([,status])=>movable(row)&&status!==row.status).map(([lane,status])=>({id:`move:${status}`,label:row.status==='blocked'&&status==='in_progress'?'Resume in progress':`Move to ${columns.find(([column])=>column===lane)![1]}`})),...(movable(row)&&!['blocked','on_hold'].includes(row.status)?[{id:'move:blocked',label:'Mark blocked'}]:[])]:[];const projectName=projectDisplayName(row.projectName);const cardTitle=visibleTaskTitle(row);const reference=orderReference(row);const resourceIncludesLocation=!!row.location&&!!row.resourceName&&row.resourceName.toLocaleLowerCase().includes(row.location.toLocaleLowerCase());return <article key={row.id} className={s.card} data-priority={row.priority??'normal'} draggable={canDrag(row)} onDragStart={event=>{if(!canDrag(row)){event.preventDefault();return;}setDragging(row.id);event.dataTransfer.setData("text/plain",row.id);event.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{setDragging('');setDropTarget('');}}>
     <Link href={cardHref(row)} className={s.cardBody} aria-label={`${cardTitle} · ${projectName}`} onClick={event=>{if(onOpenTask&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onOpenTask(row);}}}>
      <span className={s.chipRow}><span className={s.typeChip}>{reference||sourceNames[row.kind]}</span><StateBadge state={row.status}/><span className={s.priority} data-priority={row.priority??'normal'}>{row.priority??'normal'}</span></span>
      <strong>{cardTitle}</strong>
      {(row.location||row.resourceName)?<span className={s.contextChips}>{row.location&&!resourceIncludesLocation?<span className={s.locationChip}>{row.location.toLowerCase()==='factory'?<Factory size={12} aria-hidden="true"/>:<MapPin size={12} aria-hidden="true"/>}<span>{row.location.replace(/_/g,' ').replace(/^\w/,letter=>letter.toUpperCase())}</span></span>:null}{row.resourceName?<span className={resourceIncludesLocation?s.locationChip:s.resourceChip}>{resourceIncludesLocation&&row.location?.toLowerCase()==='factory'?<Factory size={12} aria-hidden="true"/>:<UsersRound size={12} aria-hidden="true"/>}<span>{row.resourceName}</span></span>:null}</span>:null}
      <span className={s.projectIdentity}><FolderKanban size={12} aria-hidden="true"/><b>{projectName}</b></span>
     </Link>
     <footer className={`${s.cardFooter} ${s.projectFooter}`}><span className={s.assignedLabel}>Assigned to</span><span className={s.owner}><Avatar name={row.ownerName||'Unassigned'} size="sm"/><span className={s.ownerName}>{row.ownerName||'Unassigned'}</span></span>{row.dueDate?<span className={s.due}><CalendarDays size={13} aria-hidden="true"/><span>Due</span><time dateTime={row.dueDate}>{shortDate(row.dueDate)}</time></span>:null}{menuItems.length?<span className={s.cardActions}><IconMenuButton ariaLabel={`Actions for ${cardTitle}`} items={menuItems} onAction={key=>{const action=String(key);if(action.startsWith('move:'))onMoveTask?.(row,action.slice(5) as BoardTaskStatus);else onOpenTask?.(row,action);}}/></span>:null}</footer>
    </article>;})}</div>:null}
   </section>;})}
  </div>
 </>;
}
