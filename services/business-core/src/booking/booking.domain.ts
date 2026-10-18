import { createHash, createHmac } from "node:crypto";

/**
 * Booking pages (plan §6.5b): the pure parts. Slots are computed in the firm's time zone from its working
 * week, hours and holidays (the work calendar, else the region pack), each host's leave, overrides and busy
 * time, the type's buffers, minimum notice, booking window and daily maximum. Nothing here reads the database.
 */

export type WorkCalendar = { timeZone: string; workingDays: number[]; start: string; end: string; holidays: string[] };
export type Interval = { start: number; end: number };
export type LeaveDay = { start: string; end: string; dayPart: "full" | "first_half" | "second_half" };
export type AvailabilityOverride = { startsOn: string; endsOn: string; kind: "extra" | "blocked"; startTime: string | null; endTime: string | null };
export type HostAvailability = {
  membershipId: string;
  leave: LeaveDay[];
  overrides: AvailabilityOverride[];
  /** Meetings, site visits, appointments, other bookings and connected-calendar busy time (UTC ms). */
  busy: Interval[];
  /** Live bookings of this type per firm-local date, for the daily maximum. */
  bookedPerDay: Record<string, number>;
};
export type SlotRules = {
  durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; minimumNoticeMinutes: number;
  windowDays: number; maxPerDay: number | null; stepMinutes: number;
};
export type Slot = { start: string; end: string; date: string; hostIds: string[] };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function validTimeZone(value: string | null | undefined): string | null {
  if (!value) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return null; }
}

function formatter(timeZone: string) {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** The wall clock of an instant in a zone: its date and minutes since midnight. */
export function wallClock(instant: number, timeZone: string): { date: string; minutes: number; epoch: number } {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const [year, month, day, hour, minute] = [part("year"), part("month"), part("day"), part("hour"), part("minute")];
  return { date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, minutes: hour * 60 + minute, epoch: Date.UTC(year, month - 1, day, hour, minute) };
}

export function addDays(date: string, amount: number) {
  const match = DATE.exec(date);
  if (!match) throw new Error("Invalid date");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * The instant a firm-local wall time happens. In a daylight-saving gap the time does not exist: `exact`
 * gives null (no slot there), `compatible` gives the first wall time after it (for working-hour edges).
 * In an overlap the earlier instant is used.
 */
export function zonedInstant(date: string, minutes: number, timeZone: string, mode: "exact" | "compatible" = "exact"): number | null {
  const day = minutes >= 1440 ? addDays(date, Math.floor(minutes / 1440)) : date;
  const minute = minutes % 1440;
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, dayOfMonth, Math.floor(minute / 60), minute % 60);
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = target + hours * 3_600_000;
    offsets.add(wallClock(sample, timeZone).epoch - sample);
  }
  const candidates = [...offsets].map((offset) => target - offset);
  const exact = candidates.filter((candidate) => wallClock(candidate, timeZone).epoch === target).sort((a, b) => a - b);
  if (exact.length) return exact[0];
  if (mode === "exact") return null;
  const after = candidates.map((candidate) => ({ candidate, wall: wallClock(candidate, timeZone).epoch })).filter(({ wall }) => wall > target)
    .sort((a, b) => a.wall - b.wall || a.candidate - b.candidate);
  return after[0]?.candidate ?? null;
}

function merge(intervals: Interval[]) {
  const sorted = intervals.filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function subtract(from: Interval[], remove: Interval[]) {
  let result = from;
  for (const cut of remove) {
    result = result.flatMap((interval) => {
      if (cut.end <= interval.start || cut.start >= interval.end) return [interval];
      return [{ start: interval.start, end: cut.start }, { start: cut.end, end: interval.end }].filter((part) => part.end > part.start);
    });
  }
  return result;
}

const covers = (date: string, start: string, end: string) => date >= start && date <= end;

/** A host's working time on one firm-local date, as UTC intervals (before busy time is taken out). */
export function hostWindows(date: string, calendar: WorkCalendar, host: Pick<HostAvailability, "leave" | "overrides">): Interval[] {
  const span = (from: string, to: string): Interval | null => {
    const start = zonedInstant(date, minutesOf(from), calendar.timeZone, "compatible");
    const end = zonedInstant(date, minutesOf(to), calendar.timeZone, "compatible");
    return start !== null && end !== null && end > start ? { start, end } : null;
  };
  const working = calendar.workingDays.includes(weekdayOf(date)) && !calendar.holidays.includes(date);
  let windows: Interval[] = working ? [span(calendar.start, calendar.end)].filter((value): value is Interval => Boolean(value)) : [];
  const overrides = host.overrides.filter((override) => covers(date, override.startsOn, override.endsOn));
  // Extra hours open time even on a day off or a holiday: the person said they work then.
  windows = merge([...windows, ...overrides.filter((override) => override.kind === "extra" && override.startTime && override.endTime)
    .map((override) => span(override.startTime!, override.endTime!)).filter((value): value is Interval => Boolean(value))]);
  for (const override of overrides.filter((item) => item.kind === "blocked")) {
    if (!override.startTime || !override.endTime) return [];
    const cut = span(override.startTime, override.endTime);
    if (cut) windows = subtract(windows, [cut]);
  }
  const middle = Math.floor((minutesOf(calendar.start) + minutesOf(calendar.end)) / 2);
  const middleTime = `${String(Math.floor(middle / 60)).padStart(2, "0")}:${String(middle % 60).padStart(2, "0")}`;
  for (const leave of host.leave.filter((item) => covers(date, item.start, item.end))) {
    if (leave.dayPart === "full") return [];
    const cut = leave.dayPart === "first_half" ? span("00:00", middleTime) : span(middleTime, "24:00");
    if (cut) windows = subtract(windows, [cut]);
  }
  return windows;
}

/**
 * Free slots between two firm-local dates (inclusive). A slot starts on a step of the firm's wall clock, fits
 * inside a host's working time (which may run past midnight), keeps its buffers clear of busy time, respects
 * the minimum notice, the booking window and the daily maximum. Each slot lists every host free for it.
 */
export function computeSlots(input: { rules: SlotRules; calendar: WorkCalendar; hosts: HostAvailability[]; from: string; to: string; now: Date }): Slot[] {
  const { rules, calendar, now } = input;
  const today = wallClock(now.getTime(), calendar.timeZone).date;
  const lastDay = addDays(today, rules.windowDays);
  const from = input.from < today ? today : input.from;
  const to = input.to > lastDay ? lastDay : input.to;
  if (from > to) return [];
  const earliest = now.getTime() + rules.minimumNoticeMinutes * MINUTE;
  const duration = rules.durationMinutes * MINUTE;
  const before = rules.bufferBeforeMinutes * MINUTE, after = rules.bufferAfterMinutes * MINUTE;
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  const free = new Map(input.hosts.map((host) => {
    // The day after the range too, so a window that runs past midnight is whole.
    const windows = merge([...dates, addDays(to, 1)].flatMap((date) => hostWindows(date, calendar, host)));
    return [host.membershipId, { windows, busy: merge(host.busy), booked: { ...host.bookedPerDay } }] as const;
  }));
  const slots: Slot[] = [];
  for (const date of dates) {
    const seen = new Set<number>();
    for (let minute = 0; minute < 1440; minute += rules.stepMinutes) {
      const start = zonedInstant(date, minute, calendar.timeZone, "exact");
      if (start === null || seen.has(start) || start < earliest) continue;
      seen.add(start);
      const end = start + duration;
      const hostIds = input.hosts.filter((host) => {
        const state = free.get(host.membershipId)!;
        if (rules.maxPerDay !== null && (state.booked[date] ?? 0) >= rules.maxPerDay) return false;
        if (!state.windows.some((window) => window.start <= start && window.end >= end)) return false;
        return !state.busy.some((busy) => busy.start < end + after && busy.end > start - before);
      }).map((host) => host.membershipId);
      if (hostIds.length) slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), date, hostIds });
    }
  }
  return slots;
}

/** The firm-local dates a request covers, checked: a range of at most 62 days. */
export function parseDateRange(from: string | undefined, to: string | undefined) {
  if (!from || !to || !DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86_400_000) return null;
  return { from, to };
}

export const isTime = (value: unknown): value is string => typeof value === "string" && TIME.test(value);
export const isDate = (value: unknown): value is string => typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(value));

/** Whether a visitor may still cancel or move a booking, and why not. */
export function changeAllowed(booking: { status: string; startsAt: Date | string }, cancelNoticeMinutes: number, now = new Date()): { allowed: true } | { allowed: false; reason: string } {
  if (!["pending", "confirmed"].includes(booking.status)) return { allowed: false, reason: "This booking can no longer be changed" };
  const start = new Date(booking.startsAt).getTime();
  if (start - now.getTime() < cancelNoticeMinutes * MINUTE) return { allowed: false, reason: "It is too close to the start to change this booking. Please contact us" };
  return { allowed: true };
}

/* ── Manage links ─────────────────────────────────────────────────────────────────────────────────── */

export const MANAGE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The signed manage link token: an HMAC of the booking and its nonce, so the same request can give it again. */
export function manageToken(secret: string, workspaceId: string, bookingId: string, nonce: string) {
  return createHmac("sha256", secret).update(`booking-manage:${workspaceId}:${bookingId}:${nonce}`).digest("base64url");
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/* ── Booking type configuration ───────────────────────────────────────────────────────────────────── */

export const BOOKING_QUESTION_FIELDS = ["emirate", "area", "serviceType", "budgetRange", "summary"] as const;
export type BookingQuestion = { field: (typeof BOOKING_QUESTION_FIELDS)[number]; required: boolean };

export function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "booking";
}

/** Questions a type asks besides name, mobile and email: known enquiry fields only, each once. */
export function parseQuestions(value: unknown): BookingQuestion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > BOOKING_QUESTION_FIELDS.length) throw new Error("Choose up to five questions");
  const fields = new Set<string>();
  return value.map((raw) => {
    const field = typeof raw === "object" && raw ? (raw as { field?: unknown }).field : raw;
    if (typeof field !== "string" || !(BOOKING_QUESTION_FIELDS as readonly string[]).includes(field) || fields.has(field)) throw new Error("Choose each question once from the enquiry fields");
    fields.add(field);
    return { field: field as BookingQuestion["field"], required: typeof raw === "object" && raw ? (raw as { required?: unknown }).required === true : false };
  });
}

/* ── Calendar file ────────────────────────────────────────────────────────────────────────────────── */

const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (value: Date | string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Folds a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length ? 74 : 75)) { parts.push(current); current = ""; }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** An .ics invitation (or its cancellation) for one booking, in UTC so no time-zone block is needed. */
export function bookingIcs(input: {
  uid: string; sequence: number; method: "REQUEST" | "CANCEL"; start: Date | string; end: Date | string; summary: string;
  description?: string; location?: string | null; organizer: { name: string; email?: string | null }; attendee?: { name: string; email?: string | null } | null; url?: string | null; now?: Date;
}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wodana//Booking pages//EN", "CALSCALE:GREGORIAN", `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${icsTime(input.now ?? new Date())}`,
    `DTSTART:${icsTime(input.start)}`,
    `DTEND:${icsTime(input.end)}`,
    `SUMMARY:${icsText(input.summary)}`,
    ...(input.description ? [`DESCRIPTION:${icsText(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    `ORGANIZER;CN=${icsText(input.organizer.name)}:mailto:${input.organizer.email || "noreply@invalid"}`,
    ...(input.attendee?.email ? [`ATTENDEE;CN=${icsText(input.attendee.name)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${input.attendee.email}`] : []),
    `STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The slot a visitor sees: its time on their clock, with the firm's zone named when it differs. */
export function describeSlot(start: Date | string, end: Date | string, timeZone: string, locale: string) {
  const format = (value: Date | string, options: Intl.DateTimeFormatOptions) => {
    try { return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(value)); }
    catch { return new Intl.DateTimeFormat("en", { timeZone, ...options }).format(new Date(value)); }
  };
  return `${format(start, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })} – ${format(end, { hour: "numeric", minute: "2-digit" })} (${timeZone})`;
}
