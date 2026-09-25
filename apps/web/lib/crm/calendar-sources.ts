import type { CalendarEvent } from "./calendar";

export type CalendarMember = { id: string; userId?: string; displayName: string; email?: string; status?: string };
export type CalendarConnection = { id: string; displayName: string; provider: string; status: string; configuration?: { accountEmail?: string }; externalAccountId?: string | null };
type Activity = { id: string; title?: string; type?: string; status?: string; dueAt?: string; ownerMembershipId?: string; ownerName?: string; description?: string; appointment?: { startsAt?: string; endsAt?: string; location?: { text?: string } } | null };
type ProjectWork = { id: string; title: string; kind: string; status: string; ownerId: string; ownerName: string; dueDate: string; projectName: string; href: string };
type GoogleItem = { id: string; connectionId: string; calendarId: string; calendarName?: string; title?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; status?: string; htmlLink?: string; description?: string; location?: string; attendees?: CalendarEvent["attendees"] };

function validDate(value: string | undefined) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

export function crmCalendarEvents(items: Activity[]): CalendarEvent[] {
  return items.filter(item => item.status !== "cancelled" && item.type !== "note").flatMap(item => {
    const start = validDate(item.appointment?.startsAt ?? item.dueAt);
    if (!start) return [];
    const end = validDate(item.appointment?.endsAt);
    return [{ id: item.id, title: item.title || "Untitled activity", start, ...(end ? { end } : {}), provider: "crm" as const, kind: item.type || "task", status: item.status, ownerId: item.ownerMembershipId, ownerName: item.ownerName, description: item.description, location: item.appointment?.location?.text }];
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

export function googleCalendarEvents(items: GoogleItem[], safeLink: (value: unknown) => string | undefined): CalendarEvent[] {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const id = `${item.connectionId}/${item.calendarId}/${item.id}`;
    if (seen.has(id) || item.status === "cancelled") return [];
    const allDay = Boolean(item.start?.date);
    const start = validDate(item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00` : undefined));
    if (!start) return [];
    seen.add(id);
    const end = validDate(item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T00:00:00` : undefined));
    return [{ id, title: item.title || "Busy", start, ...(end ? { end } : {}), allDay, provider: "google" as const, status: item.status, href: safeLink(item.htmlLink), calendarName: item.calendarName, connectionId: item.connectionId, description: item.description, location: item.location, attendees: item.attendees }];
  });
}

export function connectedGoogleForMember(connections: CalendarConnection[], member?: CalendarMember) {
  const email = member?.email?.trim().toLowerCase();
  return connections.filter(connection => connection.provider === "google_workspace" && ["connected", "degraded"].includes(connection.status) && (!member || Boolean(email && [connection.configuration?.accountEmail, connection.externalAccountId].some(value => value?.trim().toLowerCase() === email))));
}
