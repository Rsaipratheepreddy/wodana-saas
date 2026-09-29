"use client";
import { useEffect, useRef, useState } from 'react';
import { calendarDayKey, eventsForDay, timeEventLanes, type CalendarEvent, type TimeEventFold } from '@/lib/crm/calendar';
import { ControlledModalDialog, useDesignSystem, useWorkspaceZoneLabel } from '@/design-system';
import { useT } from '@/lib/i18n/i18n-provider';
import styles from './crm-calendar.module.css';
const HOUR_HEIGHT = 96;
/** Days and events are wall-clock dates in the workspace's zone (see `atWallClock`); `today` is its date key. */
export function CalendarTimeGrid({ days, today, events, onSelect, onSchedule }: { days: Date[]; today: string; events: CalendarEvent[]; onSelect: (event: CalendarEvent) => void; onSchedule: (date: Date) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  // The hours are the workspace's; its zone is named only when the viewer is elsewhere.
  const zoneLabel = useWorkspaceZoneLabel();
  const time = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const scroll = useRef<HTMLDivElement>(null);
  const period = calendarDayKey(days[0]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * HOUR_HEIGHT; }, [period]);
  const [fold, setFold] = useState<{ day: Date; fold: TimeEventFold } | null>(null);
  const single = days.length === 1;
  // A week column fits two readable lanes; a day column fits four. Anything past that folds into a "+N" chip.
  const maxLanes = single ? 4 : 2;
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(${single ? '12rem' : '6.5rem'}, 1fr))` };
  const eventButton = (event: CalendarEvent, style?: React.CSSProperties, after?: () => void) => <button key={event.id} type="button" className={styles.event} style={style} data-compact={style?.height && parseFloat(String(style.height)) <= 60 || undefined} data-tiny={style?.height && parseFloat(String(style.height)) <= 32 || undefined} data-kind={event.kind} data-provider={event.provider} data-completed={event.status === 'completed' || undefined} title={`${event.title} · ${event.start.toLocaleString(locale)}${event.end ? ` – ${time(event.end)}` : ''}`} aria-label={`${event.allDay ? t('All day') : time(event.start)} · ${event.provider === 'google' ? 'Google' : event.provider === 'project' ? t('Project') : 'CRM'} ${event.title}`} onClick={() => { onSelect(event); after?.(); }}><small>{event.allDay ? t('All day') : `${time(event.start)}${event.end ? ` – ${time(event.end)}` : ''}`}</small><span className={styles.eventTitle}>{event.title}</span></button>;
  const minuteTop = (minute: number) => `${minute / 60 * HOUR_HEIGHT}px`;
  const minuteHeight = (start: number, end: number) => `${Math.max(24, (end - start) / 60 * HOUR_HEIGHT - 3)}px`;
  const clockAt = (day: Date, minute: number) => time(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60));
  return <div className={styles.timeScroll} ref={scroll} role="group" aria-label={t(single ? 'Day calendar' : 'Week calendar')}>
    <div className={styles.timeCanvas} data-single={single || undefined}>
      <div className={styles.timeHead} style={columns}><span className={styles.timezone}>{zoneLabel ?? t('Local time')}</span>{days.map(day => <button key={day.toISOString()} type="button" className={styles.dayHeading} onClick={() => onSchedule(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10))} aria-label={t('Schedule on {date}', { date: day.toLocaleDateString(locale) })}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong data-today={calendarDayKey(day) === today || undefined}>{day.getDate()}</strong></button>)}</div>
      {events.some(event => event.allDay) && <div className={styles.allDayRow} style={columns}><small>{t('All day')}</small>{days.map(day => <div key={day.toISOString()}>{eventsForDay(events, day).filter(event => event.allDay).map(event => eventButton(event))}</div>)}</div>}
      <div className={styles.hourGrid} style={columns}><div className={styles.hours}>{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>{days.map(day => {
        const { lanes, folds } = timeEventLanes(events, day, maxLanes);
        return <section key={day.toISOString()} className={styles.timeDay} aria-label={day.toLocaleDateString(locale, { dateStyle: 'full' })}>
          {Array.from({ length: 24 }, (_, hour) => <button className={styles.timeSlot} key={hour} type="button" aria-label={t('Schedule {date} at {time}', { date: day.toLocaleDateString(locale), time: `${String(hour).padStart(2, '0')}:00` })} onClick={() => onSchedule(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))} />)}
          {lanes.map(({ event, start, end, column, columns, folded }) => {
            // Folded clusters keep a narrow strip at the inline end for the "+N" chip.
            const span = folded ? 'calc(100% - 2.25rem)' : '100%';
            return eventButton(event, { top: minuteTop(start), height: minuteHeight(start, end), insetInlineStart: `calc(${column / columns} * ${span} + 3px)`, width: `calc(${span} / ${columns} - 6px)` });
          })}
          {folds.map(item => <button key={`fold-${item.start}-${item.end}`} type="button" className={styles.moreLane} style={{ top: minuteTop(item.start), height: minuteHeight(item.start, item.end) }} aria-label={t('Show {count} more events from {time}', { count: item.hidden, time: clockAt(day, item.start) })} title={t('Show {count} more events from {time}', { count: item.hidden, time: clockAt(day, item.start) })} onClick={() => setFold({ day, fold: item })}>+{item.hidden}</button>)}
        </section>;
      })}</div>
    </div>
    <ControlledModalDialog isOpen={fold !== null} title={fold ? t('{count} events', { count: fold.fold.events.length }) : ''} description={fold ? `${fold.day.toLocaleDateString(locale, { dateStyle: 'full' })} · ${clockAt(fold.day, fold.fold.from)} – ${clockAt(fold.day, fold.fold.to)}` : undefined} onOpenChange={open => { if (!open) setFold(null); }}>
      <div className={styles.moreList}>{fold?.fold.events.map(event => eventButton(event, undefined, () => setFold(null)))}</div>
    </ControlledModalDialog>
  </div>;
}
