import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { DESIGN_STAGE_LABELS, type DesignStage } from "@/lib/flows/flow-model";
import type { CalendarEvent } from "./calendar";
import { atWallClock, zonedDateTimeToIso } from "./zoned-time";
import type { Crew } from "../logistics/types";

/**
 * Team calendars (PLM-090, PLM-091): the design team's and the factory and logistics team's work across every job,
 * read from the records that hold it. Each team can name one Google calendar; `pushTeamCalendar` sends the team's
 * work there through the person's Google connection and records which event holds which entry.
 */
export type Team = "design" | "logistics";
export const TEAMS: Team[] = ["design", "logistics"];
export type EntryKind = "render" | "drawing" | "design_deadline" | "appointment" | "presentation" | "production" | "delivery" | "installation" | "factory_slot" | "permit";
export type TeamEntry = {
  key: string; kind: EntryKind; recordId: string; subject: string; detail: string | null; start: string; end: string | null; allDay: boolean;
  days: number | null; status: string; overdue: boolean; ownerName: string | null; href: string; version?: number;
  /** Logistics bookings: the project (and work order or permit) booked, and who goes on it (people by name, the vehicle and driver). */
  projectId?: string; opportunityId?: string; workOrderId?: string | null; permitId?: string | null; crew?: Crew;
  /** A delivery or installation that needs the building permit: whether a collected one covers its day (PLM-136). */
  permit?: { covered: boolean; validTo: string | null };
};
export type TeamCalendarView = { team: Team; today: string; timeZone: string; entries: TeamEntry[]; canBook: boolean; canManage: boolean; google: boolean };
export type TeamTarget = { connectionId: string | null; calendarId: string | null; version: number };
export type TeamSettings = { targets: Record<Team, TeamTarget>; renderDays: number; drawingDays: number; designVersion: number; canRead: Record<Team, boolean>; canManage: Record<Team, boolean> };
export type BookingOptions = { cases: Array<{ id: string; title: string }>; members: Array<{ id: string; name: string; visualiser: boolean }>; renderDays: number; drawingDays: number };
export type Booking = { id: string; caseId: string; kind: "render" | "drawing"; startsOn: string; dueOn: string; days: number; status: string; version: number };

export const TEAM_LABEL: Record<Team, MessageKey> = { design: tKey("Design team"), logistics: tKey("Factory and logistics") };
export const ENTRY_LABEL: Record<EntryKind, MessageKey> = {
  render: tKey("Visualiser renders"), drawing: tKey("Technical team"), design_deadline: tKey("Design deadline"), appointment: tKey("Design appointment"),
  presentation: tKey("Presentation"), production: tKey("Production"), delivery: tKey("Delivery"), installation: tKey("Installation"), factory_slot: tKey("Factory slot"),
  permit: tKey("Permit collection"),
};

/** Who goes on a logistics booking, in one line: the people (the lead first), the vehicle and the driver. */
export function crewSummary(crew: Crew | undefined, t: Translate) {
  if (!crew) return "";
  return [
    crew.people.length ? crew.people.map((person) => (person.lead ? t("{name} (lead)", { name: person.name }) : person.name)).join(", ") : "",
    crew.vehicle ? crew.vehicle.name : "",
    crew.driver ? t("Driver: {name}", { name: crew.driver.name }) : "",
  ].filter(Boolean).join(" · ");
}

export class TeamCalendarError extends Error { constructor(message: string, public status: number) { super(message); } }

/** One request to the team calendars' API (through the workspace's own route). */
export async function teamRequest<T>(workspaceId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const [resource, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("workspaceId", workspaceId);
  const response = await fetch(`/api/workspace/team-calendars/${resource}?${query}`, {
    method, signal, cache: "no-store", ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new TeamCalendarError(payload?.message ?? tKey("The calendar could not be updated."), response.status);
  return payload as T;
}

const days = (t: Translate, count: number | null) => (count === null ? "" : count === 1 ? t("1 day") : t("{count} days", { count }));

/** PLM-152: the work inside a design step that has its own deadline on the calendar. */
const DESIGN_TASK_LABELS: Record<string, MessageKey> = {
  team_allocation: tKey("Design team"), site_measure: tKey("Design site measure"), sample_collection: tKey("Sample collection"),
  inspection: tKey("Design inspection"),
};

/** An entry's title in the viewer's language: what it is and for whom (and how many days render or 2D time needs). */
export function teamEntryTitle(entry: TeamEntry, t: Translate) {
  if (entry.kind === "render" || entry.kind === "drawing") return [t(ENTRY_LABEL[entry.kind]), entry.subject, days(t, entry.days)].filter(Boolean).join(" · ");
  if (entry.kind === "design_deadline") return t("{stage} due · {client}", { stage: t(DESIGN_STAGE_LABELS[entry.detail as DesignStage] ?? DESIGN_TASK_LABELS[entry.detail ?? ""] ?? tKey("Design deadline")), client: entry.subject });
  if (entry.kind === "appointment" || entry.kind === "production") return [entry.detail, entry.subject].filter(Boolean).join(" · ");
  return `${t(ENTRY_LABEL[entry.kind])} · ${entry.subject}`;
}

const dayAt = (day: string) => new Date(`${day}T00:00:00`);
const nextDay = (day: string) => { const date = dayAt(day); date.setDate(date.getDate() + 1); return date; };

/** Entries as the calendar draws them: all-day spans on their days, timed ones on the workspace's wall clock. */
export function teamCalendarEvents(entries: TeamEntry[], t: Translate, timeZone: string): CalendarEvent[] {
  return entries.map((entry) => ({
    id: entry.key, title: teamEntryTitle(entry, t), provider: "team" as const, kind: entry.kind, status: entry.status, ownerName: entry.ownerName ?? undefined, href: entry.href,
    overdue: entry.overdue, team: entry,
    ...(entry.allDay ? { allDay: true, start: dayAt(entry.start), end: nextDay(entry.end ?? entry.start) }
      : { start: atWallClock(entry.start, timeZone), ...(entry.end ? { end: atWallClock(entry.end, timeZone) } : {}) }),
  }));
}

type PlanEntry = TeamEntry & { fingerprint: string };
type PushPlan = {
  team: Team; connectionId: string; calendarId: string; timeZone: string; workingHours: { start: string; end: string };
  create: PlanEntry[]; update: Array<PlanEntry & { eventId: string; etag: string }>; cancel: Array<{ entryKey: string; eventId: string; etag: string }>;
};
type PushResult = { entryKey: string; eventId?: string; etag?: string; fingerprint?: string; startsOn?: string; removed?: boolean };

/** The Google event an entry becomes: an all-day span runs the firm's working hours from its first to its last day. */
export function googleEvent(entry: TeamEntry, plan: Pick<PushPlan, "timeZone" | "workingHours">, t: Translate, origin = "") {
  const start = entry.allDay ? zonedDateTimeToIso(`${entry.start}T${plan.workingHours.start}`, plan.timeZone) : entry.start;
  const end = entry.allDay ? zonedDateTimeToIso(`${entry.end ?? entry.start}T${plan.workingHours.end}`, plan.timeZone) : entry.end ?? entry.start;
  const description = [entry.ownerName ? t("With {name}", { name: entry.ownerName }) : "", crewSummary(entry.crew, t), origin ? `${origin}${entry.href}` : ""].filter(Boolean).join("\n");
  // Google takes an event that ends after it starts and spans at most 31 days: a longer run shows its first 31 days.
  const from = Date.parse(start ?? entry.start), to = Date.parse(end ?? entry.start);
  const until = Math.min(Math.max(to, from + 30 * 60_000), from + 31 * 86_400_000);
  return { summary: teamEntryTitle(entry, t).slice(0, 300), description: description || undefined, start: new Date(from).toISOString(), end: new Date(until).toISOString(), timeZone: plan.timeZone };
}

async function tool(workspaceId: string, connectionId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/workspace/integration-connections/${connectionId}/tools`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...body }) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new TeamCalendarError(payload?.message ?? tKey("Google events could not be updated."), response.status);
  return payload as { eventId?: string; etag?: string };
}

/**
 * Sends a team's work to its Google calendar: new entries are created (an idempotency key per entry and content, so a
 * retry never doubles an event), changed ones updated and gone ones cancelled; what Google returned is recorded.
 * One failure doesn't stop the rest; it is counted.
 */
export async function pushTeamCalendar(workspaceId: string, team: Team, t: Translate, origin = "") {
  const plan = await teamRequest<PushPlan>(workspaceId, `${team}/push-plan`);
  const results: PushResult[] = [];
  let failed = 0, created = 0, updated = 0, cancelled = 0;
  const day = (entry: TeamEntry) => (entry.allDay ? entry.start : zonedDay(entry.start, plan.timeZone));
  for (const entry of plan.create) {
    try {
      const event = await tool(workspaceId, plan.connectionId, { action: "calendar.create", idempotencyKey: `team.${team}.${entry.key}.${entry.fingerprint.slice(0, 12)}`,
        payload: { calendarId: plan.calendarId, ...googleEvent(entry, plan, t, origin), attendeeEmails: [], sendUpdates: "none" } });
      if (event.eventId && event.etag) { results.push({ entryKey: entry.key, eventId: event.eventId, etag: event.etag, fingerprint: entry.fingerprint, startsOn: day(entry) }); created++; }
    } catch { failed++; }
  }
  for (const entry of plan.update) {
    try {
      const event = await tool(workspaceId, plan.connectionId, { action: "calendar.update", eventId: entry.eventId,
        payload: { calendarId: plan.calendarId, etag: entry.etag, ...googleEvent(entry, plan, t, origin), sendUpdates: "none" } });
      if (event.eventId && event.etag) { results.push({ entryKey: entry.key, eventId: event.eventId, etag: event.etag, fingerprint: entry.fingerprint, startsOn: day(entry) }); updated++; }
    } catch { failed++; }
  }
  for (const gone of plan.cancel) {
    try {
      await tool(workspaceId, plan.connectionId, { action: "calendar.cancel", eventId: gone.eventId, payload: { calendarId: plan.calendarId, etag: gone.etag, sendUpdates: "none" } });
      results.push({ entryKey: gone.entryKey, removed: true });
      cancelled++;
    } catch { failed++; }
  }
  for (let index = 0; index < results.length; index += 200)
    await teamRequest(workspaceId, `${team}/pushes`, "POST", { connectionId: plan.connectionId, calendarId: plan.calendarId, results: results.slice(index, index + 200) });
  return { created, updated, cancelled, failed };
}

function zonedDay(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}
