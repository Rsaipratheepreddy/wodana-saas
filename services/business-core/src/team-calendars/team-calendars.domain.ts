import { createHash } from "node:crypto";
import { workdays, type WorkCalendar } from "../project-core/work-calendar";

/**
 * Team calendars (PLM-090, PLM-091): one view of a team's work across every job, read from the records that hold it.
 *   design     render and 2D time designers book, design-journey deadlines, design appointments and presentations
 *   logistics  what the factory produces (work-order planned dates), deliveries, installations and factory slots
 * Nothing is copied into a calendar table: each entry is its source record. A workspace can name one Google calendar
 * per team; the entries are pushed there through the existing Google connection, and the push remembers which event
 * holds which entry so a moved entry updates its event and a removed one cancels it.
 */
export const TEAMS = ["design", "logistics"] as const;
export type Team = (typeof TEAMS)[number];
export const isTeam = (value: unknown): value is Team => typeof value === "string" && (TEAMS as readonly string[]).includes(value);

/** Render or 2D time: the Visualiser renders, the technical team draws. */
export const BOOKING_KINDS = ["render", "drawing"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_LABEL: Record<BookingKind, string> = { render: "3D render", drawing: "2D drawings" };

export type EntryKind = BookingKind | "design_deadline" | "appointment" | "presentation" | "production" | "delivery" | "installation" | "factory_slot" | "permit";

/** Who goes on a logistics booking (HRMS workers by name, the lead first), the vehicle and its driver. */
export type EntryCrew = {
  people: Array<{ id: string; name: string; lead: boolean }>; crew: { id: string; name: string } | null; vehicle: { id: string; name: string } | null;
  driver: { id: string; name: string } | null; note: string; version: number;
};

/**
 * One entry. All-day entries carry calendar days (`start` and the inclusive `end` as YYYY-MM-DD); timed ones carry
 * instants. `subject` is the client or project; `detail` the record's own words (a stage key, a work order title).
 */
export type TeamEntry = {
  key: string;
  kind: EntryKind;
  recordId: string;
  subject: string;
  detail: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  /** Working days the work needs (render and 2D bookings). */
  days: number | null;
  status: string;
  overdue: boolean;
  ownerName: string | null;
  href: string;
  /** A booking's version, for its commands. */
  version?: number;
  /** Logistics bookings: the project (and work order or permit) the entry books, and who goes on it. */
  projectId?: string; opportunityId?: string; workOrderId?: string | null; permitId?: string | null; crew?: EntryCrew;
  /** A delivery or installation where the building permit is required: whether a collected one covers its day (PLM-136). */
  permit?: { covered: boolean; validTo: string | null };
};

/** The days of a booking: it starts on the first working day on or after the day asked and runs `days` working days. */
export function bookingDays(startsOn: string, days: number, calendar: WorkCalendar) {
  const math = workdays(calendar);
  const start = math.onOrAfter(startsOn);
  return { startsOn: start, dueOn: math.shift(start, Math.max(1, days) - 1) };
}

export function bookingProblem(input: { kind?: unknown; startsOn?: unknown; days?: unknown; note?: unknown }) {
  if (!(BOOKING_KINDS as readonly string[]).includes(String(input.kind))) return "Choose a render or 2D drawings";
  if (typeof input.startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || Number.isNaN(Date.parse(input.startsOn))) return "Choose the day it starts";
  if (!Number.isInteger(input.days) || (input.days as number) < 1 || (input.days as number) > 60) return "Days are between 1 and 60";
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > 500)) return "Keep the note under 500 characters";
  return null;
}

/** What a Google event shows changes with these; an overdue flag moving every day does not. */
export function entryFingerprint(entry: Pick<TeamEntry, "kind" | "subject" | "detail" | "start" | "end" | "allDay" | "days" | "status" | "ownerName" | "crew" | "permit">) {
  // Who goes changes the event too; entries nobody is booked on keep the fingerprint they always had.
  const crew = entry.crew && (entry.crew.people.length || entry.crew.vehicle || entry.crew.driver)
    ? [[entry.crew.people.map((person) => `${person.name}${person.lead ? "*" : ""}`), entry.crew.vehicle?.name ?? null, entry.crew.driver?.name ?? null]] : [];
  const permit = entry.permit ? [entry.permit.covered] : [];
  return createHash("sha256").update(JSON.stringify([entry.kind, entry.subject, entry.detail, entry.start, entry.end, entry.allDay, entry.days, entry.status, entry.ownerName, ...crew, ...permit]))
    .digest("hex").slice(0, 32);
}

/** The calendar day an entry starts on, in the workspace's zone. */
export function entryDay(entry: Pick<TeamEntry, "start" | "allDay">, timeZone: string) {
  if (entry.allDay) return entry.start.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(entry.start));
}

export type Pushed = { entryKey: string; eventId: string; etag: string; fingerprint: string; startsOn: string };
export type PushPlan = {
  create: Array<TeamEntry & { fingerprint: string }>;
  update: Array<TeamEntry & { fingerprint: string; eventId: string; etag: string }>;
  cancel: Pushed[];
};

/**
 * What to send to the team's Google calendar for one window: entries never pushed are created, entries whose content
 * changed update their event, and events whose entry is gone (cancelled, or no longer in the team's work) are
 * cancelled. Events whose day lies outside the window are left alone: they are not "gone", just not looked at.
 */
export function pushPlan(entries: TeamEntry[], pushed: Pushed[], window: { from: string; to: string }, timeZone: string): PushPlan {
  const byKey = new Map(pushed.map((row) => [row.entryKey, row]));
  const live = new Set(entries.map((entry) => entry.key));
  const plan: PushPlan = { create: [], update: [], cancel: [] };
  for (const entry of entries) {
    const fingerprint = entryFingerprint(entry);
    const before = byKey.get(entry.key);
    if (!before) plan.create.push({ ...entry, fingerprint });
    else if (before.fingerprint !== fingerprint) plan.update.push({ ...entry, fingerprint, eventId: before.eventId, etag: before.etag });
  }
  for (const row of pushed) if (!live.has(row.entryKey) && row.startsOn >= window.from && row.startsOn < window.to) plan.cancel.push(row);
  // Entries are keyed by day so a long window stays readable in Google: earliest first.
  plan.create.sort((a, b) => entryDay(a, timeZone).localeCompare(entryDay(b, timeZone)) || a.key.localeCompare(b.key));
  return plan;
}

const DAY = 86_400_000;
export const plusDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);

/** A calendar range from the query: both days, `from` before `to`, at most 100 days apart. */
export function rangeProblem(from: unknown, to: unknown) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== "string" || typeof to !== "string" || !day.test(from) || !day.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return "Choose a valid range";
  if (from >= to) return "Choose a valid range";
  if (Date.parse(to) - Date.parse(from) > 100 * DAY) return "Choose a range of at most 100 days";
  return null;
}

/** Overdue alerts look back this far: older late items are history, not news, the first time the rule runs. */
export const ALERT_LOOKBACK_DAYS = 14;
