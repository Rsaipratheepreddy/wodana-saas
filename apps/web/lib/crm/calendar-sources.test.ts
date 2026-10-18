import { describe, expect, it } from "vitest";
import { connectedGoogleForMember, crmCalendarEvents, googleCalendarEvents, projectCalendarEvents } from "./calendar-sources";

describe("unified calendar sources", () => {
  it("keeps assigned CRM activity and dated project work distinct", () => {
    expect(crmCalendarEvents([{ id: "a", title: "Call", type: "call", dueAt: "2026-09-24T09:00:00Z", ownerMembershipId: "member" }, { id: "note", type: "note", dueAt: "2026-09-24T09:00:00Z" }])).toMatchObject([{ provider: "crm", ownerId: "member", title: "Call" }]);
    expect(projectCalendarEvents([{ id: "p:t:1", title: "Install", kind: "task", status: "planned", ownerId: "member", ownerName: "Maya", dueDate: "2026-09-24", projectName: "Villa", href: "/workspace/projects/p/site-work?record=1" }])).toMatchObject([{ provider: "project", allDay: true, calendarName: "Villa", ownerId: "member" }]);
  });
  it("places timed events on the workspace's clock, and all-day events on their date (CAL-2)", () => {
    const [meeting] = crmCalendarEvents([{ id: "a", title: "Site visit", type: "meeting", dueAt: "2026-09-24T20:30:00Z", appointment: { startsAt: "2026-09-24T20:30:00Z", endsAt: "2026-09-24T21:30:00Z" } }], "Asia/Dubai");
    expect([meeting.start.getDate(), meeting.start.getHours(), meeting.start.getMinutes(), meeting.end?.getHours()]).toEqual([25, 0, 30, 1]);
    const [allDay] = googleCalendarEvents([{ id: "h", connectionId: "c", calendarId: "primary", start: { date: "2026-09-24" }, end: { date: "2026-09-25" } }], () => undefined, "Pacific/Auckland");
    expect([allDay.allDay, allDay.start.getDate(), allDay.start.getHours()]).toEqual([true, 24, 0]);
  });
  it("deduplicates Google events and confines personal calendars to the matching account", () => {
    expect(googleCalendarEvents([{ id: "g", connectionId: "c", calendarId: "primary", title: "Review", start: { dateTime: "2026-09-24T09:00:00Z" }, end: { dateTime: "2026-09-24T10:00:00Z" } }, { id: "g", connectionId: "c", calendarId: "primary", start: { dateTime: "2026-09-24T09:00:00Z" } }], () => undefined)).toHaveLength(1);
    const connections = [{ id: "a", provider: "google_workspace", status: "connected", displayName: "A", configuration: { accountEmail: "maya@example.com" } }, { id: "b", provider: "google_workspace", status: "connected", displayName: "B", configuration: { accountEmail: "other@example.com" } }];
    expect(connectedGoogleForMember(connections, { id: "m", displayName: "Maya", email: "MAYA@example.com" }).map(item => item.id)).toEqual(["a"]);
    expect(connectedGoogleForMember(connections).map(item => item.id)).toEqual(["a", "b"]);
  });
});
