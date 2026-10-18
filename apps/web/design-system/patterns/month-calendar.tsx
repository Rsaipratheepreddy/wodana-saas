"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "../components/actions";
import { useDesignSystem } from "../foundations/provider";

export type MonthCalendarTone = "neutral" | "brand" | "info" | "success" | "warning" | "danger";
export type MonthCalendarEvent = {
  id: string;
  /** Start day, YYYY-MM-DD. */
  date: string;
  /** Last day, YYYY-MM-DD; defaults to `date`. */
  endDate?: string;
  title: string;
  detail?: string;
  tone?: MonthCalendarTone;
  kind?: string;
  /** When set, the agenda entry is a link instead of a button. */
  href?: string;
};

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDay(date);
}
export function monthOf(day: string) { return day.slice(0, 7); }
export function shiftMonth(month: string, amount: number) {
  const [year, index] = month.split("-").map(Number);
  return isoDay(new Date(Date.UTC(year, index - 1 + amount, 1))).slice(0, 7);
}
export function monthLabel(month: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
export function dayLabel(day: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** The 5 or 6 weeks that display a month, Monday first by default. */
export function monthGrid(month: string, weekStartsOn = 1) {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  return days.slice(35).every((day) => !day.startsWith(month)) ? days.slice(0, 35) : days;
}

export function eventsOn(events: MonthCalendarEvent[], day: string) {
  return events.filter((event) => event.date <= day && (event.endDate ?? event.date) >= day);
}

/**
 * Month view: one grid, a few chips per day and a "+N more" overflow. Selecting a day
 * hands the full list to the caller, which renders the agenda beside the grid.
 */
export function MonthCalendar({ month, events, today, selected, onSelect, onMonthChange, weekStartsOn = 1, nonWorkingWeekdays = [], maxPerDay = 3, locale: localeProp }: {
  month: string;
  events: MonthCalendarEvent[];
  today?: string;
  selected?: string;
  onSelect?: (day: string) => void;
  onMonthChange: (month: string) => void;
  /** The first day of the week (0 Sunday … 6 Saturday), from the workspace's region. */
  weekStartsOn?: number;
  nonWorkingWeekdays?: number[];
  maxPerDay?: number;
  locale?: string;
}) {
  const t = useT();
  const region = useDesignSystem();
  const locale = localeProp ?? region.locale;
  const days = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const weekdays = useMemo(() => days.slice(0, 7).map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))), [days, locale]);
  return <div className="wd-month" role="group" aria-label={t("Calendar · {month}", { month: monthLabel(month, locale) })}>
    <header className="wd-month-head">
      <h3>{monthLabel(month, locale)}</h3>
      <div className="wd-month-nav">
        {today ? <Button onPress={() => { onMonthChange(monthOf(today)); onSelect?.(today); }} size="compact" variant="quiet">{t("Today")}</Button> : null}
        <IconButton aria-label={t("Previous month")} onPress={() => onMonthChange(shiftMonth(month, -1))} size="compact"><ChevronLeft size={16} /></IconButton>
        <IconButton aria-label={t("Next month")} onPress={() => onMonthChange(shiftMonth(month, 1))} size="compact"><ChevronRight size={16} /></IconButton>
      </div>
    </header>
    <div className="wd-month-weekdays" aria-hidden="true">{weekdays.map((name) => <span key={name}>{name}</span>)}</div>
    <div className="wd-month-grid">
      {days.map((day) => {
        const list = eventsOn(events, day);
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const outside = !day.startsWith(month);
        return <button
          aria-label={`${dayLabel(day, locale)}${list.length ? ` · ${list.length === 1 ? t("1 item") : t("{count} items", { count: list.length })}` : ""}`}
          aria-pressed={selected === day || undefined}
          className="wd-month-day"
          data-outside={outside || undefined}
          data-quiet={nonWorkingWeekdays.includes(weekday) || undefined}
          data-selected={selected === day || undefined}
          data-today={today === day || undefined}
          key={day}
          onClick={() => onSelect?.(day)}
          type="button"
        >
          <span className="wd-month-date">{Number(day.slice(8))}</span>
          <span className="wd-month-chips">
            {list.slice(0, maxPerDay).map((event) => <span className="wd-event-chip wd-month-chip" data-continues={event.date !== day || undefined} data-tone={event.tone ?? "neutral"} key={event.id} title={event.title}>{event.title}</span>)}
            {list.length > maxPerDay ? <span className="wd-event-more">{t("+{count} more", { count: list.length - maxPerDay })}</span> : null}
          </span>
        </button>;
      })}
    </div>
  </div>;
}

/** Agenda for one selected day, rendered beside the month grid. */
export function DayAgenda({ day, events, locale: localeProp, onOpen, empty }: {
  day: string;
  events: MonthCalendarEvent[];
  locale?: string;
  onOpen?: (event: MonthCalendarEvent) => void;
  empty?: string;
}) {
  const t = useT();
  const region = useDesignSystem();
  const locale = localeProp ?? region.locale;
  const list = eventsOn(events, day);
  return <section aria-label={t("Agenda · {day}", { day: dayLabel(day, locale) })} className="wd-day-agenda">
    <header><strong>{dayLabel(day, locale)}</strong><span>{list.length ? (list.length === 1 ? t("1 item") : t("{count} items", { count: list.length })) : empty ?? t("Nothing scheduled")}</span></header>
    <ol>
      {list.map((event) => {
        const body = <><span className="wd-agenda-dot" data-tone={event.tone ?? "neutral"} /><span><strong>{event.title}</strong>{event.detail ? <small>{event.detail}</small> : null}</span>{event.kind ? <em>{event.kind}</em> : null}</>;
        return <li key={event.id}>{event.href ? <a href={event.href}>{body}</a> : onOpen ? <button onClick={() => onOpen(event)} type="button">{body}</button> : <div>{body}</div>}</li>;
      })}
    </ol>
  </section>;
}
