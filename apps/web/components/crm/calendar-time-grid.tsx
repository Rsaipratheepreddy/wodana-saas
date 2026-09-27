"use client";
import { useEffect, useRef } from 'react';
import { calendarDayKey, eventsForDay, timeEventLayout, type CalendarEvent } from '@/lib/crm/calendar';
import { useDesignSystem } from '@/design-system';
import { useT } from '@/lib/i18n/i18n-provider';
import styles from './crm-calendar.module.css';
export function CalendarTimeGrid({ days, events, onSelect, onSchedule }: { days: Date[]; events: CalendarEvent[]; onSelect: (event: CalendarEvent) => void; onSchedule: (date: Date) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const time = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const scroll = useRef<HTMLDivElement>(null);
  const period = calendarDayKey(days[0]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * 96; }, [period]);
  const today = calendarDayKey(new Date());
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(${days.length === 1 ? '12rem' : '6.5rem'}, 1fr))` };
  const eventButton = (event: CalendarEvent, style?: React.CSSProperties) => <button key={event.id} type="button" className={styles.event} style={style} data-compact={style?.height && parseFloat(String(style.height)) <= 60 || undefined} data-tiny={style?.height && parseFloat(String(style.height)) <= 32 || undefined} data-kind={event.kind} data-provider={event.provider} data-completed={event.status === 'completed' || undefined} title={`${event.title} · ${event.start.toLocaleString(locale)}${event.end ? ` – ${time(event.end)}` : ''}`} aria-label={`${event.allDay ? t('All day') : time(event.start)} · ${event.provider === 'google' ? 'Google' : event.provider === 'project' ? t('Project') : 'CRM'} ${event.title}`} onClick={() => onSelect(event)}><small>{event.allDay ? t('All day') : `${time(event.start)}${event.end ? ` – ${time(event.end)}` : ''}`}</small><span className={styles.eventTitle}>{event.title}</span></button>;
  return <div className={styles.timeScroll} ref={scroll} role="group" aria-label={t(days.length === 1 ? 'Day calendar' : 'Week calendar')}>
    <div className={styles.timeCanvas} data-single={days.length === 1 || undefined}>
      <div className={styles.timeHead} style={columns}><span className={styles.timezone}>{t('Local time')}</span>{days.map(day => <button key={day.toISOString()} type="button" className={styles.dayHeading} onClick={() => onSchedule(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10))} aria-label={t('Schedule on {date}', { date: day.toLocaleDateString(locale) })}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong data-today={calendarDayKey(day) === today || undefined}>{day.getDate()}</strong></button>)}</div>
      {events.some(event => event.allDay) && <div className={styles.allDayRow} style={columns}><small>{t('All day')}</small>{days.map(day => <div key={day.toISOString()}>{eventsForDay(events, day).filter(event => event.allDay).map(event => eventButton(event))}</div>)}</div>}
      <div className={styles.hourGrid} style={columns}><div className={styles.hours}>{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>{days.map(day => <section key={day.toISOString()} className={styles.timeDay} aria-label={day.toLocaleDateString(locale, { dateStyle: 'full' })}>{Array.from({ length: 24 }, (_, hour) => <button className={styles.timeSlot} key={hour} type="button" aria-label={t('Schedule {date} at {time}', { date: day.toLocaleDateString(locale), time: `${String(hour).padStart(2, '0')}:00` })} onClick={() => onSchedule(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))} />)}{timeEventLayout(events, day).map(({ event, start, end, column, columns }) => eventButton(event, { top: `${start / 60 * 96}px`, height: `${Math.max(24, (end - start) / 60 * 96 - 3)}px`, insetInlineStart: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }))}</section>)}</div>
    </div>
  </div>;
}
