"use client";
import { useState } from 'react';
import { parseDate, today } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, IconButton, useDesignSystem } from '@/design-system';
import { siteCalendarDays, siteLabels, visitFallsOn, visitWallTime, type SiteRecord } from '@/lib/pre-project/site';
import { CaseModal } from './case-controls';
import calendar from '../crm/crm-calendar.module.css';
import styles from './site.module.css';

export function SiteCalendar({records,timezone,weekStartsOn=1,canEdit,onSchedule,onOpen}:{records:SiteRecord[];timezone:string;weekStartsOn?:number;canEdit:boolean;onSchedule:(date:string)=>void;onOpen:(record:SiteRecord)=>void}) {
 const {locale}=useDesignSystem();const [anchor,setAnchor]=useState(()=>today(timezone));const [dayOpen,setDayOpen]=useState<string|null>(null);
 const days=siteCalendarDays(anchor.toString(),weekStartsOn);const currentDay=today(timezone).toString();
 const label=(day:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,{...options,timeZone:'UTC'}).format(parseDate(day).toDate('UTC'));
 const eventsFor=(day:string)=>records.filter(r=>visitFallsOn(r,day,timezone)).sort((a,b)=>(a.scheduledAt??'').localeCompare(b.scheduledAt??''));
 const time=(record:SiteRecord,day:string)=>visitWallTime(record.scheduledAt,timezone).slice(0,10)===day?new Intl.DateTimeFormat(locale,{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(record.scheduledAt!)):'Continues';
 const event=(record:SiteRecord,day:string)=><button type="button" className={`${calendar.event} ${styles.calendarEvent}`} key={record.id} data-status={record.status} aria-label={`${record.title}, ${time(record,day)}, ${siteLabels[record.status]}`} onClick={()=>{setDayOpen(null);onOpen(record);}}><CalendarDays size={12}/><span><span className={calendar.eventTitle}>{record.title}</span><small>{time(record,day)}</small></span></button>;
 return <section aria-label="Site visits calendar" className={styles.siteCalendar}>
  <div className={calendar.toolbar}><div className={calendar.navigation}><h2 aria-live="polite">{label(anchor.toString(),{month:'long',year:'numeric'})}</h2><Button size="compact" onPress={()=>setAnchor(today(timezone))}>Today</Button><IconButton aria-label="Previous month" onPress={()=>setAnchor(a=>a.subtract({months:1}))}><ChevronLeft data-directional="true" size={16}/></IconButton><IconButton aria-label="Next month" onPress={()=>setAnchor(a=>a.add({months:1}))}><ChevronRight data-directional="true" size={16}/></IconButton></div><span className={styles.calendarTimezone}>All times · {timezone}</span></div>
  <div className={calendar.scroll}><div className={`${calendar.grid} ${styles.monthGrid}`} data-mode="month" role="group" aria-label="Month calendar">
   {days.slice(0,7).map(day=><div className={calendar.weekday} key={day.toString()}>{label(day.toString(),{weekday:'short'})}</div>)}
   {days.map(day=>{const key=day.toString();const items=eventsFor(key);return <section className={calendar.day} key={key} data-outside={day.month!==anchor.month||undefined} aria-label={label(key,{dateStyle:'full'})}><button type="button" className={calendar.date} aria-current={key===currentDay?'date':undefined} data-today={key===currentDay||undefined} aria-label={`${canEdit?'Schedule a visit on':'View visits on'} ${label(key,{dateStyle:'full'})}`} onClick={()=>canEdit?onSchedule(key):setDayOpen(key)}>{day.day}</button>{items.slice(0,2).map(record=>event(record,key))}{items.length>2&&<button type="button" className={calendar.more} onClick={()=>setDayOpen(key)}>+{items.length-2} more</button>}</section>;})}
  </div></div>
  <p className={styles.sectionHint}>{canEdit?'Choose a date to schedule a visit. Open a visit to see its details.':'Open a visit to see its details.'}</p>
  {dayOpen&&<CaseModal size="md" title={label(dayOpen,{dateStyle:'full'})} description={`Site visits · ${timezone}`} onClose={()=>setDayOpen(null)}>{eventsFor(dayOpen).length?eventsFor(dayOpen).map(record=>event(record,dayOpen)):<p>No visits scheduled for this day.</p>}</CaseModal>}
 </section>;
}
