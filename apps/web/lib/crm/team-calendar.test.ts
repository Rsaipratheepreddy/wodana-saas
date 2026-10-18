import { afterEach, describe, expect, it, vi } from "vitest";
import { translatorFor } from "@/lib/i18n/keys";
import { googleEvent, pushTeamCalendar, teamCalendarEvents, teamEntryTitle, type TeamEntry } from "./team-calendar";
import { allowedTeamCalendarPath } from "./team-calendar-path";

const t = translatorFor({});
const render = (patch: Partial<TeamEntry> = {}): TeamEntry => ({
  key: "booking:b1", kind: "render", recordId: "b1", subject: "Maya Client", detail: null, start: "2026-10-12", end: "2026-10-15", allDay: true, days: 4,
  status: "booked", overdue: false, ownerName: "Vic Visualiser", href: "/workspace/pre-projects/cases/c1/overview", version: 1, ...patch,
});
afterEach(() => vi.unstubAllGlobals());

describe("team calendar entries (PLM-090/091)", () => {
  it("say what the work is, for whom, and how many days a render needs", () => {
    expect(teamEntryTitle(render(), t)).toBe("3D renders · Maya Client · 4 days");
    expect(teamEntryTitle(render({ kind: "drawing", days: 1 }), t)).toBe("Technical drawings · Maya Client · 1 day");
    expect(teamEntryTitle(render({ kind: "design_deadline", detail: "concepts", days: null }), t)).toBe("Concepts due · Maya Client");
    expect(teamEntryTitle(render({ kind: "production", detail: "WO-0012 Wardrobe", subject: "P-7 · Villa 12", days: null }), t)).toBe("WO-0012 Wardrobe · P-7 · Villa 12");
    expect(teamEntryTitle(render({ kind: "installation", subject: "P-7 · Villa 12", days: null }), t)).toBe("Installation · P-7 · Villa 12");
  });

  it("span their days on the calendar, the last day included", () => {
    const [event] = teamCalendarEvents([render({ overdue: true })], t, "Asia/Dubai");
    expect(event).toMatchObject({ provider: "team", allDay: true, overdue: true, kind: "render" });
    expect(event.start).toEqual(new Date("2026-10-12T00:00:00"));
    expect(event.end).toEqual(new Date("2026-10-16T00:00:00"));
  });

  it("become Google events over the firm's working hours in its zone", () => {
    const event = googleEvent(render(), { timeZone: "Asia/Dubai", workingHours: { start: "09:00", end: "18:00" } }, t, "https://palm.wodana.ai");
    expect(event).toMatchObject({ summary: "3D renders · Maya Client · 4 days", start: "2026-10-12T05:00:00.000Z", end: "2026-10-15T14:00:00.000Z", timeZone: "Asia/Dubai" });
    expect(event.description).toContain("https://palm.wodana.ai/workspace/pre-projects/cases/c1/overview");
    // Google's limit: at most 31 days, ending after it starts.
    const long = googleEvent(render({ start: "2026-10-01", end: "2026-12-31" }), { timeZone: "UTC", workingHours: { start: "09:00", end: "18:00" } }, t);
    expect(Date.parse(long.end) - Date.parse(long.start)).toBe(31 * 86_400_000);
  });

  it("reach only their own resources", () => {
    expect(allowedTeamCalendarPath(["design"], "GET")).toBe(true);
    expect(allowedTeamCalendarPath(["logistics", "push-plan"], "GET")).toBe(true);
    expect(allowedTeamCalendarPath(["sales"], "GET")).toBe(false);
    expect(allowedTeamCalendarPath(["bookings", "00000000-0000-4000-8000-000000000001", "move"], "POST")).toBe(true);
    expect(allowedTeamCalendarPath(["bookings", "x", "move"], "POST")).toBe(false);
    expect(allowedTeamCalendarPath(["design", "settings"], "PUT")).toBe(true);
    expect(allowedTeamCalendarPath(["design", "settings"], "DELETE")).toBe(false);
  });
});

describe("sending a team calendar to Google", () => {
  it("creates new entries with a stable key, updates changed ones, cancels gone ones and records what Google returned", async () => {
    const plan = { team: "design", connectionId: "conn-1", calendarId: "design@example.com", timeZone: "UTC", workingHours: { start: "09:00", end: "17:00" },
      create: [{ ...render(), fingerprint: "a".repeat(32) }, { ...render({ key: "booking:b2", recordId: "b2" }), fingerprint: "b".repeat(32) }],
      update: [{ ...render({ key: "booking:b3", recordId: "b3" }), fingerprint: "c".repeat(32), eventId: "ev3", etag: "e3" }],
      cancel: [{ entryKey: "booking:b4", eventId: "ev4", etag: "e4" }] };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.includes("/push-plan")) return { ok: true, status: 200, json: async () => plan };
      if (url.includes("/pushes")) return { ok: true, status: 200, json: async () => ({ saved: 2, removed: 1 }) };
      // Google refuses the second new entry: it is counted, the rest go on.
      if (body.action === "calendar.create" && String(body.idempotencyKey).includes("booking:b2")) return { ok: false, status: 502, json: async () => ({ message: "Google is unavailable" }) };
      return { ok: true, status: 200, json: async () => ({ eventId: `ev-${calls.length}`, etag: "new" }) };
    }));
    const result = await pushTeamCalendar("w1", "design", t, "https://palm.wodana.ai");
    expect(result).toEqual({ created: 1, updated: 1, cancelled: 1, failed: 1 });
    const create = calls.find((call) => call.body.action === "calendar.create")!;
    expect(create.url).toBe("/api/workspace/integration-connections/conn-1/tools");
    expect(create.body).toMatchObject({ workspaceId: "w1", idempotencyKey: `team.design.booking:b1.${"a".repeat(12)}`,
      payload: { calendarId: "design@example.com", summary: "3D renders · Maya Client · 4 days", sendUpdates: "none", attendeeEmails: [] } });
    expect(calls.find((call) => call.body.action === "calendar.update")!.body).toMatchObject({ eventId: "ev3", payload: { etag: "e3" } });
    expect(calls.find((call) => call.body.action === "calendar.cancel")!.body).toMatchObject({ eventId: "ev4", payload: { etag: "e4" } });
    const recorded = calls.find((call) => call.url.includes("/pushes"))!.body;
    expect(recorded).toMatchObject({ connectionId: "conn-1", calendarId: "design@example.com" });
    expect((recorded.results as Array<{ entryKey: string }>).map((item) => item.entryKey)).toEqual(["booking:b1", "booking:b3", "booking:b4"]);
  });
});
