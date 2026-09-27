"use client";
import {CalendarDays} from 'lucide-react';
import {Avatar,Badge,useDesignSystem} from '@/design-system';
import type {RecordData} from '@/lib/crm/client';
import {useT} from '@/lib/i18n/i18n-provider';
import {tKey,type MessageKey} from '@/lib/i18n/keys';
import s from '../projects/global-work-board.module.css';
const LANES:Record<string,MessageKey>={Overdue:tKey('Overdue'),Today:tKey('Today'),Upcoming:tKey('Upcoming'),'In progress':tKey('In progress'),Completed:tKey('Completed')};
const PRIORITIES:Record<string,MessageKey>={low:tKey('Low'),normal:tKey('Normal'),medium:tKey('Medium'),high:tKey('High'),urgent:tKey('Urgent')};
export function FollowUpKanban({groups,timeZone,onOpen}:{groups:{title:string;items:RecordData[]}[];timeZone:string;onOpen:(id:string)=>void}){
 const t=useT();
 const {locale}=useDesignSystem();
 const lane=(title:string)=>LANES[title]?t(LANES[title]):title;
 return <div className={s.board} role="region" aria-label={t("Sales tasks Kanban")} tabIndex={0}>
  {groups.map((group,index)=><section className={s.column} key={group.title} aria-labelledby={`sales-task-lane-${index}`} data-empty={!group.items.length||undefined} data-state={group.title==='Overdue'?'blocked':group.title==='Today'?'active':group.title==='Upcoming'?'review':group.title==='Completed'?'done':'planned'}>
   <header className={s.heading}><h2 id={`sales-task-lane-${index}`}><i aria-hidden="true"/>{lane(group.title)}</h2><span data-pending={group.items.length>0&&group.title!=="Completed"||undefined} aria-label={t('{count} tasks',{count:group.items.length})}>{group.items.length}</span></header>
   {group.items.length?<div className={s.cards}>{group.items.map(item=>{const due=Date.parse(String(item.dueAt??''));const owner=String(item.ownerName??t('Unassigned'));const priority=String(item.priority??'normal').toLowerCase();return <button type="button" className={s.card} data-priority={priority} key={String(item.id)} onClick={()=>onOpen(String(item.id))}>
    <span className={s.chipRow}><Badge tone="neutral">{t(item.type==='call'?'Call':item.type==='meeting'?'Meeting':'Task')}</Badge><Badge tone={group.title==='Overdue'?'danger':group.title==='Completed'?'success':group.title==='Today'?'warning':'info'}>{lane(group.title)}</Badge><span className={s.priority} data-priority={priority}>{PRIORITIES[priority]?t(PRIORITIES[priority]):priority}</span></span>
    <strong>{String(item.title??t('Untitled task'))}</strong><span className={s.project}>{String(item.partyName??item.leadTitle??t('Not linked'))}</span>
    <span className={s.cardFooter}><span className={s.owner}><Avatar name={owner} size="sm"/><span className={s.srOnly}>{owner}</span></span>{Number.isFinite(due)&&<span className={s.due}><CalendarDays size={13} aria-hidden="true"/><time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat(locale,{timeZone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(due)}</time></span>}</span>
   </button>;})}</div>:null}
  </section>)}
 </div>;
}
