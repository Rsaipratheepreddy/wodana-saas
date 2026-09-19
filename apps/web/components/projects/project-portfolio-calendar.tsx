"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays } from "lucide-react";
import { Agenda, Badge, CalendarOverlay, Container, EmptyState, type CalendarEvent } from "@/design-system";
import styles from "./project-portfolio-calendar.module.css";

type Department = { id: string; code: string; name: string; visibleName: string; color: string };
type BookingEvent = {
  id: string; projectId: string; projectName: string; title: string; date: string; endDate: string;
  startTime: string; endTime: string; bookingStatus: string; conflictIds: string[];
  department: Department; resource: { name: string };
};
type ScheduleItem = {
  id: string; kind: string; projectId?: string; projectName?: string; title?: string; date?: string;
  startsAt?: string; endsAt?: string; department?: Department | null;
};
export type PortfolioCalendarData = {
  range: { from: string; to: string; timezone: string };
  departments: Department[];
  events: BookingEvent[];
  items: ScheduleItem[];
  overlapCount: number;
  conflictCount: number;
};

function wallInstant(date: string, time: string, timeZone: string) {
  const wall = `${date}T${time.length === 5 ? `${time}:00` : time}`;
  const guess = new Date(`${wall}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(guess).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (represented - guess.getTime())).toISOString();
}

export function ProjectPortfolioCalendar({ data }: { data: PortfolioCalendarData }) {
  const [visible, setVisible] = useState(() => new Set(data.departments.map((department) => department.id)));
  const events = useMemo<CalendarEvent[]>(() => [
    ...data.events.map((event) => ({
      id: event.id,
      title: event.title,
      start: wallInstant(event.date, event.startTime, data.range.timezone),
      end: wallInstant(event.endDate, event.endTime, data.range.timezone),
      calendarId: event.department.id,
      resource: `${event.projectName} · ${event.resource.name}`,
      status: event.conflictIds.length ? "Conflict" : event.bookingStatus,
    })),
    ...data.items.map((item) => ({
      id: `plan:${item.id}`,
      title: item.title || item.kind.replaceAll("_", " "),
      start: item.startsAt || wallInstant(item.date || data.range.from, "09:00", data.range.timezone),
      end: item.endsAt || item.startsAt || wallInstant(item.date || data.range.from, "10:00", data.range.timezone),
      calendarId: item.department?.id || `kind:${item.kind}`,
      resource: item.projectName,
      status: item.kind.replaceAll("_", " "),
    })),
  ].filter((event) => visible.has(event.calendarId) || event.calendarId.startsWith("kind:"))
    .sort((left, right) => left.start.localeCompare(right.start)), [data, visible]);

  return <Container as="section" aria-label="Project portfolio calendar" className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Portfolio control</span><h1>Project calendar</h1><p>Confirmed bookings, delivery commitments and site activity across every project.</p></div>
      <Link href="/workspace/projects">View portfolio <ArrowRight aria-hidden="true" size={15} /></Link>
    </header>
    <div className={styles.summary} role="group" aria-label="Calendar summary">
      <span><CalendarDays aria-hidden="true" size={15}/><strong>{events.length}</strong> scheduled entries</span>
      {data.overlapCount ? <span><Badge tone="warning">{data.overlapCount} overlaps</Badge></span> : null}
      {data.conflictCount ? <span><AlertTriangle aria-hidden="true" size={15}/><Badge tone="danger">{data.conflictCount} conflicts</Badge></span> : null}
      <time>{data.range.from} – {data.range.to} · {data.range.timezone}</time>
    </div>
    {data.departments.length ? <CalendarOverlay calendars={data.departments.map((department) => ({ id: department.id, label: department.visibleName, color: department.color, visible: visible.has(department.id) }))} onToggle={(id, enabled) => setVisible((current) => { const next = new Set(current); if (enabled) next.add(id); else next.delete(id); return next; })} /> : null}
    {events.length ? <Agenda events={events} locale="en-AE" timeZone={data.range.timezone} /> : <EmptyState icon={<CalendarDays size={24}/>} title="No scheduled work in this range" description="Confirmed resource bookings and project commitments will appear here automatically." />}
  </Container>;
}
