"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Badge } from "../components/status";
import { formatDate } from "../foundations/formatters";
import { useDesignSystem } from "../foundations/provider";

export type CalendarSource = { id: string; label: string; color: string; visible?: boolean };
export type CalendarEvent = { id: string; title: string; start: string; end: string; calendarId: string; resource?: string; status?: string };

export function CalendarOverlay({ calendars, onToggle }: { calendars: CalendarSource[]; onToggle?: (id: string, visible: boolean) => void }) { return <div className="wd-calendar-sources">{calendars.map((calendar) => <label key={calendar.id}><input checked={calendar.visible !== false} onChange={(event) => onToggle?.(calendar.id, event.target.checked)} type="checkbox" /><span style={{ background: calendar.color }} />{calendar.label}</label>)}</div>; }

export function Agenda({ events, locale: localeProp, timeZone: timeZoneProp }: { events: CalendarEvent[]; locale?: string; timeZone?: string }) { const region = useDesignSystem(); const locale = localeProp ?? region.locale; const timeZone = timeZoneProp ?? region.timeZone; const groups = useMemo(() => Object.groupBy(events, (event) => formatDate(event.start, { locale, timeZone }, { dateStyle: "full" })), [events, locale, timeZone]); return <div className="wd-agenda">{Object.entries(groups).map(([day, entries]) => <section key={day}><header>{day}</header>{entries?.map((event) => <article key={event.id}><Clock3 size={14} /><time>{formatDate(event.start, { locale, timeZone }, { hour: "2-digit", minute: "2-digit" })}</time><span><strong>{event.title}</strong>{event.resource ? <small>{event.resource}</small> : null}</span>{event.status ? <Badge>{event.status}</Badge> : null}</article>)}</section>)}</div>; }

export function WeekSchedule({ days, events }: { days: Date[]; events: CalendarEvent[] }) { const { locale, timeZone } = useDesignSystem(); return <div className="wd-week-schedule"><div className="wd-week-hours">{Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 8}:00</span>)}</div>{days.map((day) => <section key={day.toISOString()}><header><span>{formatDate(day, { locale, timeZone }, { weekday: "short" })}</span><strong>{day.getDate()}</strong></header><div>{events.filter((event) => new Date(event.start).toDateString() === day.toDateString()).map((event) => { const start = new Date(event.start); const end = new Date(event.end); const top = ((start.getHours() + start.getMinutes() / 60) - 8) * 48; const height = Math.max(28, ((end.getTime() - start.getTime()) / 3_600_000) * 48); return <article key={event.id} style={{ insetBlockStart: top, blockSize: height }}><strong>{event.title}</strong><small>{start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</small></article>; })}</div></section>)}</div>; }

export type GanttDay = { date: string; label: string; month?: string; off?: boolean; today?: boolean };
export type GanttRow = {
  id: string; label: ReactNode; ariaLabel: string;
  /** Day indexes, end included; no bar when absent. */
  start?: number; end?: number;
  /** The committed dates, drawn as a faint line under the bar. */
  baseline?: { start: number; end: number } | null;
  tone?: "default" | "late" | "done" | "blocked"; depth?: 0 | 1;
  /** On the critical path: drawn with a strong edge (the row's label says so too). */
  critical?: boolean;
  /** Short text on the bar (e.g. "WO-0001 · 40 h"); it runs on beside the bar when the bar is too short. */
  barLabel?: string;
  /** The bar runs past the visible days on that side, so that end is drawn squared off. */
  continues?: "start" | "end" | "both";
};
export type GanttGroup = { id: string; label: string; rows: GanttRow[] };

/**
 * A timeline of work by day: names stay in view while the days scroll, days off are shaded, today and
 * any markers (e.g. a handover date) are drawn across, and each row opens with its name.
 */
export function Gantt({ ariaLabel, days, groups, labelHeader, markers = [], onRowAction }: {
  ariaLabel: string; days: GanttDay[]; groups: GanttGroup[]; labelHeader: string; markers?: Array<{ index: number; label: string }>; onRowAction?: (id: string) => void;
}) {
  const column = (from: number, to: number) => ({ gridColumn: `${from + 1} / ${to + 2}` });
  const box = useRef<HTMLDivElement>(null);
  // Which side still has days out of view: that edge fades, so a bar cut by the edge reads as continuing.
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  useEffect(() => {
    const frame = box.current;
    if (!frame) return;
    const measure = () => {
      const hidden = frame.scrollWidth - frame.clientWidth;
      const from = Math.abs(frame.scrollLeft);
      setMore({ start: hidden > 1 && from > 1, end: hidden > 1 && hidden - from > 1 });
    };
    measure();
    frame.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    return () => { frame.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [days.length]);
  // Open on today: two days before it sit right after the names, whichever way the page reads.
  useEffect(() => {
    const frame = box.current;
    const today = frame?.querySelector<HTMLElement>(".wd-gantt-day[data-today]");
    const names = frame?.querySelector<HTMLElement>(".wd-gantt-corner");
    if (!frame || !today || !names) return;
    const day = today.getBoundingClientRect();
    const edge = names.getBoundingClientRect();
    const lead = 2 * day.width;
    frame.scrollBy?.({ left: getComputedStyle(frame).direction === "rtl" ? day.right + lead - edge.left : day.left - lead - edge.right });
  }, [days.length]);
  const months = days.reduce<Array<{ label: string; from: number; to: number }>>((list, day, index) => {
    if (day.month || !list.length) list.push({ label: day.month ?? "", from: index, to: index });
    else list[list.length - 1].to = index;
    return list;
  }, []);
  // The frame is the size the days fit into: a day is as wide as the space allows, never narrower than a
  // readable minimum, and the timeline scrolls (without a scrollbar) only when the days don't fit.
  return <div className="wd-gantt-frame" data-more-end={more.end || undefined} data-more-start={more.start || undefined}><div aria-label={ariaLabel} className="wd-gantt wd-scroll-quiet" ref={box} role="region" tabIndex={0} style={{ "--wd-gantt-days": days.length } as React.CSSProperties}>
    <div className="wd-gantt-canvas">
      <div aria-hidden="true" className="wd-gantt-shade">
        {days.map((day) => <i data-off={day.off || undefined} data-today={day.today || undefined} key={day.date} />)}
        {markers.map((marker) => <b key={marker.label} style={column(marker.index, marker.index)} title={marker.label} />)}
      </div>
      <div className="wd-gantt-head">
        <span className="wd-gantt-corner">{labelHeader}</span>
        <div aria-hidden="true" className="wd-gantt-scale">
          {months.map((month) => <span className="wd-gantt-month" key={`${month.from}`} style={column(month.from, month.to)}><span>{month.label}</span></span>)}
          {days.map((day, index) => <span className="wd-gantt-day" data-off={day.off || undefined} data-today={day.today || undefined} key={day.date} style={column(index, index)}>{day.label}</span>)}
        </div>
      </div>
      {groups.map((group) => <section aria-label={group.label} key={group.id}>
        <div className="wd-gantt-group">{group.label}</div>
        {group.rows.map((row) => <div className="wd-gantt-row" key={row.id}>
          <span className="wd-gantt-label" data-depth={row.depth || undefined}>
            {onRowAction ? <button aria-label={row.ariaLabel} onClick={() => onRowAction(row.id)} title={row.ariaLabel} type="button">{row.label}</button> : row.label}
          </span>
          <div className="wd-gantt-track">
            {row.baseline ? <span aria-hidden="true" className="wd-gantt-baseline" style={column(row.baseline.start, row.baseline.end)} /> : null}
            {row.start !== undefined && row.end !== undefined ? <span aria-hidden="true" className="wd-gantt-bar" data-tone={row.tone ?? "default"} data-critical={row.critical || undefined} data-continues={row.continues} onClick={onRowAction ? () => onRowAction(row.id) : undefined} style={column(row.start, row.end)}>{row.barLabel ? <span className="wd-gantt-bar-label">{row.barLabel}</span> : null}</span> : null}
          </div>
        </div>)}
      </section>)}
    </div>
  </div></div>;
}

export function Availability({ label, slots }: { label: string; slots: Array<{ start: string; end: string; available: boolean }> }) { return <div className="wd-availability"><header><CalendarDays size={15} /><strong>{label}</strong></header>{slots.map((slot) => <span data-available={slot.available} key={`${slot.start}-${slot.end}`}>{slot.start}–{slot.end}</span>)}</div>; }
