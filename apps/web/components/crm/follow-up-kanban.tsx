"use client";
import {CalendarDays} from 'lucide-react';
import {Avatar,Badge} from '@/design-system';
import type {RecordData} from '@/lib/crm/client';
import s from '../projects/global-work-board.module.css';
export function FollowUpKanban({groups,timeZone,onOpen}:{groups:{title:string;items:RecordData[]}[];timeZone:string;onOpen:(id:string)=>void}){
 return <div className={s.board} role="region" aria-label="Sales tasks Kanban" tabIndex={0}>
  {groups.map((group,index)=><section className={s.column} key={group.title} aria-labelledby={`sales-task-lane-${index}`} data-empty={!group.items.length||undefined} data-state={group.title==='Overdue'?'blocked':group.title==='Today'?'active':group.title==='Upcoming'?'review':group.title==='Completed'?'done':'planned'}>
   <header className={s.heading}><h2 id={`sales-task-lane-${index}`}><i aria-hidden="true"/>{group.title}</h2><span data-pending={group.items.length>0&&group.title!=="Completed"||undefined} aria-label={`${group.items.length} tasks`}>{group.items.length}</span></header>
   {group.items.length?<div className={s.cards}>{group.items.map(item=>{const due=Date.parse(String(item.dueAt??''));const owner=String(item.ownerName??'Unassigned');const priority=String(item.priority??'normal').toLowerCase();return <button type="button" className={s.card} data-priority={priority} key={String(item.id)} onClick={()=>onOpen(String(item.id))}>
    <span className={s.chipRow}><Badge tone="neutral">{String(item.type==='call'?'Call':item.type==='meeting'?'Meeting':'Task')}</Badge><Badge tone={group.title==='Overdue'?'danger':group.title==='Completed'?'success':group.title==='Today'?'warning':'info'}>{group.title}</Badge><span className={s.priority} data-priority={priority}>{priority}</span></span>
    <strong>{String(item.title??'Untitled task')}</strong><span className={s.project}>{String(item.partyName??item.leadTitle??'Not linked')}</span>
    <span className={s.cardFooter}><span className={s.owner}><Avatar name={owner} size="sm"/><span className={s.srOnly}>{owner}</span></span>{Number.isFinite(due)&&<span className={s.due}><CalendarDays size={13} aria-hidden="true"/><time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat('en-GB',{timeZone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(due)}</time></span>}</span>
   </button>;})}</div>:null}
  </section>)}
 </div>;
}
