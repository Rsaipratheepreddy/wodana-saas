import { tKey } from "@/lib/i18n/keys";
import type { CalendarEvent } from "./calendar";
import { atWallClock } from "./zoned-time";

export type CalendarMember = { id: string; userId?: string; displayName: string; email?: string; status?: string };
export type CalendarConnection = { id: string; displayName: string; provider: string; status: string; configuration?: { accountEmail?: string }; externalAccountId?: string | null };
type Activity = { id: string; title?: string; type?: string; status?: string; dueAt?: string; ownerMembershipId?: string; ownerName?: string; description?: string; appointment?: { startsAt?: string; endsAt?: string; location?: { text?: string } } | null };
type ProjectWork = { id: string; title: string; kind: string; status: string; ownerId: string; ownerName: string; dueDate: string; projectName: string; href: string };
type GoogleItem = { id: string; connectionId: string; calendarId: string; calendarName?: string; title?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; status?: string; htmlLink?: string; description?: string; location?: string; attendees?: CalendarEvent["attendees"] };

function validDate(value: string | undefined) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

/** A timed event on the workspace's wall clock (CAL-2), so the grid draws the workspace's day wherever the viewer is. */
function timed(value: string | undefined, timeZone?: string) {
  const date = validDate(value);
  return date && timeZone ? atWallClock(date, timeZone) : date;
}

export function crmCalendarEvents(items: Activity[], timeZone?: string): CalendarEvent[] {
  return items.filter(item => item.status !== "cancelled" && item.type !== "note").flatMap(item => {
    const start = timed(item.appointment?.startsAt ?? item.dueAt, timeZone);
    if (!start) return [];
    const end = timed(item.appointment?.endsAt, timeZone);
    return [{ id: item.id, title: item.title || tKey("Untitled activity"), start, ...(end ? { end } : {}), provider: "crm" as const, kind: item.type || "task", status: item.status, ownerId: item.ownerMembershipId, ownerName: item.ownerName, description: item.description, location: item.appointment?.location?.text }];
  });
}

export function projectCalendarEvents(items: ProjectWork[]): CalendarEvent[] {
  return items.flatMap(item => {
    if (!item.dueDate) return [];
    const start = validDate(`${item.dueDate.slice(0, 10)}T00:00:00`);
    if (!start) return [];
    return [{ id: item.id, title: item.title, start, allDay: true, provider: "project" as const, kind: item.kind, status: item.status, ownerId: item.ownerId, ownerName: item.ownerName, calendarName: item.projectName, href: item.href }];
  });
}

export function googleCalendarEvents(items: GoogleItem[], safeLink: (value: unknown) => string | undefined, timeZone?: string): CalendarEvent[] {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const id = `${item.connectionId}/${item.calendarId}/${item.id}`;
    if (seen.has(id) || item.status === "cancelled") return [];
    const allDay = Boolean(item.start?.date);
    const start = item.start?.dateTime ? timed(item.start.dateTime, timeZone) : validDate((item.start?.date ? `${item.start.date}T00:00:00` : undefined));
    if (!start) return [];
    seen.add(id);
    const end = item.end?.dateTime ? timed(item.end.dateTime, timeZone) : validDate(item.end?.date ? `${item.end.date}T00:00:00` : undefined);
    return [{ id, title: item.title || tKey("Busy"), start, ...(end ? { end } : {}), allDay, provider: "google" as const, status: item.status, href: safeLink(item.htmlLink), calendarName: item.calendarName, connectionId: item.connectionId, description: item.description, location: item.location, attendees: item.attendees }];
  });
}

export function connectedGoogleForMember(connections: CalendarConnection[], member?: CalendarMember) {
  const email = member?.email?.trim().toLowerCase();
  return connections.filter(connection => connection.provider === "google_workspace" && ["connected", "degraded"].includes(connection.status) && (!member || Boolean(email && [connection.configuration?.accountEmail, connection.externalAccountId].some(value => value?.trim().toLowerCase() === email))));
}
