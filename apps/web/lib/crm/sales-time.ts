import { zonedToUtc } from "./zoned-time";

/** When a salesperson must respond: the first-response SLA that is still running. */
export type RespondBy = { dueAt: string; state: "on_track" | "warning" | "breached"; minutesLeft: number };

const RUNNING = new Set(["active", "warning", "breached"]);

export function respondBy(lead: { slaStatus?: string | null; slaDueAt?: string | null; slaWarningAt?: string | null }, now: number): RespondBy | null {
  if (!lead.slaDueAt || !lead.slaStatus || !RUNNING.has(lead.slaStatus)) return null;
  const due = Date.parse(lead.slaDueAt);
  if (Number.isNaN(due)) return null;
  const minutesLeft = Math.round((due - now) / 60_000);
  const warning = lead.slaWarningAt ? Date.parse(lead.slaWarningAt) : NaN;
  const state = lead.slaStatus === "breached" || minutesLeft <= 0 ? "breached"
    : lead.slaStatus === "warning" || (!Number.isNaN(warning) && warning <= now) ? "warning" : "on_track";
  return { dueAt: lead.slaDueAt, state, minutesLeft };
}

/** "42 min", "3 h 5 min", "2 d": how long is left, or how long overdue. */
export function durationParts(minutes: number) {
  const value = Math.abs(minutes);
  if (value < 60) return { unit: "min" as const, minutes: value };
  if (value < 24 * 60) return { unit: "h" as const, hours: Math.floor(value / 60), minutes: value % 60 };
  return { unit: "d" as const, days: Math.floor(value / (24 * 60)) };
}

/** "10:00" today, "Sat 10:00" another day, in the workspace's zone and language. */
export function deadlineText(at: string, format: { locale?: string; timeZone?: string }, now = new Date()) {
  const date = new Date(at);
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: format.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const time = new Intl.DateTimeFormat(format.locale, { timeZone: format.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (day(date) === day(now)) return time;
  return `${new Intl.DateTimeFormat(format.locale, { timeZone: format.timeZone, weekday: "short" }).format(date)} ${time}`;
}

type Window = { start: string; end: string };
export type SalesHours = { timeZone: string; weeklyHours: Record<string, Window[]> | null; holidays: string[]; dateOverrides: Record<string, Window[]> };

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The Sales working hours from the active first-response policy; none means every day, all day. */
export function salesHours(policies: Array<{ eventType: string; status: string; calculationMode?: string; schedule: Record<string, unknown> }>, workspaceZone: string): SalesHours {
  const policy = policies.find((item) => item.eventType === "first_response" && item.status === "active");
  const schedule = policy?.schedule ?? {};
  const business = policy?.calculationMode === "business" || schedule.mode === "business";
  const weekly = business && schedule.weeklyHours && typeof schedule.weeklyHours === "object" ? schedule.weeklyHours as Record<string, Window[]> : null;
  return {
    timeZone: business && typeof schedule.timezone === "string" ? schedule.timezone : workspaceZone,
    weeklyHours: weekly,
    holidays: Array.isArray(schedule.holidays) ? schedule.holidays.map(String) : [],
    dateOverrides: schedule.dateOverrides && typeof schedule.dateOverrides === "object" ? schedule.dateOverrides as Record<string, Window[]> : {},
  };
}

function localDate(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })
    .formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday).toLowerCase() };
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function windowsOn(hours: SalesHours, date: string): Window[] {
  if (!hours.weeklyHours) return [{ start: "00:00", end: "24:00" }];
  if (hours.holidays.includes(date)) return [];
  if (hours.dateOverrides[date]) return hours.dateOverrides[date];
  const weekday = DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return hours.weeklyHours[weekday] ?? [];
}

/** The first working moment at or after `from`. */
export function nextWorkingMoment(hours: SalesHours, from: Date): Date {
  const start = localDate(from, hours.timeZone).date;
  for (let offset = 0; offset < 21; offset += 1) {
    const date = addDays(start, offset);
    for (const window of [...windowsOn(hours, date)].sort((a, b) => a.start.localeCompare(b.start))) {
      const opens = Date.parse(zonedToUtc(date, window.start, hours.timeZone) ?? "");
      const closes = window.end === "24:00" ? Date.parse(zonedToUtc(addDays(date, 1), "00:00", hours.timeZone) ?? "") : Date.parse(zonedToUtc(date, window.end, hours.timeZone) ?? "");
      if (from.getTime() < opens) return new Date(opens);
      if (from.getTime() < closes) return from;
    }
  }
  return from;
}

/** The start of the first working day after `from`'s local day, `days` days on. */
export function workingDayStart(hours: SalesHours, from: Date, days: number): Date {
  const date = addDays(localDate(from, hours.timeZone).date, days);
  const start = Date.parse(zonedToUtc(date, "00:00", hours.timeZone) ?? "");
  const moment = nextWorkingMoment(hours, new Date(start));
  // Elapsed time has no opening hour: suggest a morning call instead of midnight.
  if (!hours.weeklyHours) return new Date(Date.parse(zonedToUtc(localDate(moment, hours.timeZone).date, "09:00", hours.timeZone) ?? "") || moment.getTime());
  return moment;
}

/** S-16: the next try, one tap away: in 2 working hours, the next working morning, or in 3 days. */
export function quickFollowUps(hours: SalesHours, now: Date) {
  return [
    { id: "two_hours" as const, at: nextWorkingMoment(hours, new Date(now.getTime() + 2 * 3_600_000)) },
    { id: "next_day" as const, at: workingDayStart(hours, now, 1) },
    { id: "three_days" as const, at: workingDayStart(hours, now, 3) },
  ];
}

/** An instant as the date-and-time field's wall-clock value in a zone ("yyyy-mm-ddThh:mm"). */
export function wallClock(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
