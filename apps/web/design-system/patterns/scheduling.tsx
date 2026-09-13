"use client";

import { useMemo, type ReactNode } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Badge } from "../components/status";
import { formatDate } from "../foundations/formatters";

export type CalendarSource = { id: string; label: string; color: string; visible?: boolean };
export type CalendarEvent = { id: string; title: string; start: string; end: string; calendarId: string; resource?: string; status?: string };

export function CalendarOverlay({ calendars, onToggle }: { calendars: CalendarSource[]; onToggle?: (id: string, visible: boolean) => void }) { return <div className="wd-calendar-sources">{calendars.map((calendar) => <label key={calendar.id}><input checked={calendar.visible !== false} onChange={(event) => onToggle?.(calendar.id, event.target.checked)} type="checkbox" /><span style={{ background: calendar.color }} />{calendar.label}</label>)}</div>; }

export function Agenda({ events, locale = "en-IN", timeZone = "Asia/Kolkata" }: { events: CalendarEvent[]; locale?: string; timeZone?: string }) { const groups = useMemo(() => Object.groupBy(events, (event) => formatDate(event.start, { locale, timeZone }, { dateStyle: "full" })), [events, locale, timeZone]); return <div className="wd-agenda">{Object.entries(groups).map(([day, entries]) => <section key={day}><header>{day}</header>{entries?.map((event) => <article key={event.id}><Clock3 size={14} /><time>{formatDate(event.start, { locale, timeZone }, { hour: "2-digit", minute: "2-digit" })}</time><span><strong>{event.title}</strong>{event.resource ? <small>{event.resource}</small> : null}</span>{event.status ? <Badge>{event.status}</Badge> : null}</article>)}</section>)}</div>; }

export function WeekSchedule({ days, events }: { days: Date[]; events: CalendarEvent[] }) { return <div className="wd-week-schedule"><div className="wd-week-hours">{Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 8}:00</span>)}</div>{days.map((day) => <section key={day.toISOString()}><header><span>{formatDate(day, {}, { weekday: "short" })}</span><strong>{day.getDate()}</strong></header><div>{events.filter((event) => new Date(event.start).toDateString() === day.toDateString()).map((event) => { const start = new Date(event.start); const end = new Date(event.end); const top = ((start.getHours() + start.getMinutes() / 60) - 8) * 48; const height = Math.max(28, ((end.getTime() - start.getTime()) / 3_600_000) * 48); return <article key={event.id} style={{ insetBlockStart: top, blockSize: height }}><strong>{event.title}</strong><small>{start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></article>; })}</div></section>)}</div>; }

export type TimelineItem = { id: string; label: string; start: number; duration: number; progress?: number; children?: TimelineItem[] };
export function Gantt({ columns, items, renderLabel }: { columns: string[]; items: TimelineItem[]; renderLabel?: (item: TimelineItem) => ReactNode }) { return <div className="wd-gantt" style={{ "--wd-gantt-columns": columns.length } as React.CSSProperties}><header><span>Work item</span>{columns.map((column) => <span key={column}>{column}</span>)}</header>{items.map((item) => <div className="wd-gantt-row" key={item.id}><strong>{renderLabel?.(item) ?? item.label}</strong><div className="wd-gantt-track"><span style={{ gridColumn: `${item.start + 1} / span ${item.duration}` }}><i style={{ inlineSize: `${item.progress ?? 0}%` }} />{item.progress != null ? `${item.progress}%` : null}</span></div></div>)}</div>; }

export function Availability({ label, slots }: { label: string; slots: Array<{ start: string; end: string; available: boolean }> }) { return <div className="wd-availability"><header><CalendarDays size={15} /><strong>{label}</strong></header>{slots.map((slot) => <span data-available={slot.available} key={`${slot.start}-${slot.end}`}>{slot.start}–{slot.end}</span>)}</div>; }
