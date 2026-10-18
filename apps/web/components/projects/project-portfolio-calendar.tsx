"use client";

import { useMemo, useState } from "react";
import { CalendarOverlay, DayAgenda, MonthCalendar, StageHeader, monthOf, type MonthCalendarEvent, type StageMetric } from "@/design-system";
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

const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

function todayIn(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

/** Every project's confirmed bookings, deliveries, site visits and commitments on one month grid. */
export function ProjectPortfolioCalendar({ data }: { data: PortfolioCalendarData }) {
  const today = useMemo(() => todayIn(data.range.timezone || "UTC"), [data.range.timezone]);
  const [month, setMonth] = useState(() => monthOf(today));
  const [day, setDay] = useState(today);
  const [visible, setVisible] = useState(() => new Set(data.departments.map((department) => department.id)));
  const events = useMemo<MonthCalendarEvent[]>(() => [
    ...data.events.filter((event) => visible.has(event.department.id)).map((event) => ({
      id: event.id,
      date: event.date,
      endDate: event.endDate || event.date,
      title: `${event.resource.name} · ${event.title}`,
      detail: `${event.projectName} · ${event.startTime}–${event.endTime}${event.conflictIds.length ? " · conflict" : ""}`,
      tone: event.conflictIds.length ? "danger" as const : "brand" as const,
      kind: event.department.visibleName,
      href: `/workspace/projects/${event.projectId}/plan-teams?view=teams`,
    })),
    ...data.items.filter((item) => !item.department || visible.has(item.department.id)).map((item) => {
      const date = item.date || item.startsAt?.slice(0, 10) || data.range.from;
      return {
        id: `plan:${item.id}`,
        date,
        endDate: item.endsAt?.slice(0, 10) || date,
        title: item.title || label(item.kind),
        detail: item.projectName,
        tone: "info" as const,
        kind: label(item.kind),
        href: item.projectId ? `/workspace/projects/${item.projectId}/overview` : undefined,
      };
    }),
  ].sort((left, right) => left.date.localeCompare(right.date)), [data, visible]);
  const inMonth = events.filter((event) => event.date.startsWith(month) || (event.endDate ?? event.date).startsWith(month));
  const projects = new Set(data.events.map((event) => event.projectId).concat(data.items.map((item) => item.projectId ?? "").filter(Boolean)));
  const metrics: StageMetric[] = [
    { label: "This month", value: inMonth.length },
    { label: "Projects scheduled", value: projects.size },
    { label: "Overlaps", value: data.overlapCount, tone: data.overlapCount ? "attention" : "neutral" },
    { label: "Conflicts", value: data.conflictCount, tone: data.conflictCount ? "danger" : "neutral" },
  ];
  return <section aria-label="Project portfolio calendar" className={styles.page}>
    <StageHeader
      description={`Confirmed team bookings, deliveries and site activity across every project. ${data.range.from} to ${data.range.to}, ${data.range.timezone}.`}
      metrics={metrics}
      title="Calendar"
    >
      {data.departments.length > 1 ? <CalendarOverlay calendars={data.departments.map((department) => ({ id: department.id, label: department.visibleName, color: department.color, visible: visible.has(department.id) }))} onToggle={(id, enabled) => setVisible((current) => { const next = new Set(current); if (enabled) next.add(id); else next.delete(id); return next; })} /> : null}
    </StageHeader>
    <div className="wd-calendar-layout">
      <MonthCalendar events={events} month={month} onMonthChange={setMonth} onSelect={setDay} selected={day} today={today} />
      <DayAgenda day={day} empty="No bookings or commitments" events={events} />
    </div>
  </section>;
}
