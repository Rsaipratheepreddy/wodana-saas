import { describe, expect, it } from "vitest";
import { feedCards } from "../client-portal/portal-feed";
import { minutesDueSource } from "../reminders/sources/meetings";
import { REMINDER_KIND_DEFAULTS, REMINDER_KIND_INFO } from "../reminders/reminders-contract";
import { minutesProblem, parseMinutes } from "./meeting-minutes";

const ID = "6f1c2a0e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
const base = { minutesId: ID, version: 0, title: " Kick-off ", body: " Agreed the render sign-off by 20 Oct. ", fileIds: [], shared: true };

describe("PLM-153: minutes of a client meeting", () => {
  it("are written once a meeting or call on the calendar has started, never on a cancelled one", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(minutesProblem({ type: "meeting", status: "completed", startsAt: "2026-10-13T09:00:00Z" }, now)).toBeNull();
    expect(minutesProblem({ type: "call", status: "pending", startsAt: "2026-10-13T11:30:00Z" }, now)).toBeNull();
    expect(minutesProblem({ type: "meeting", status: "pending", startsAt: "2026-10-14T09:00:00Z" }, now)).toBe("Minutes can be written once the meeting has started.");
    expect(minutesProblem({ type: "meeting", status: "cancelled", startsAt: "2026-10-12T09:00:00Z" }, now)).toBe("This meeting was cancelled.");
    expect(minutesProblem({ type: "meeting", status: "pending", startsAt: null }, now)).toBe("Give the meeting its time first.");
    expect(minutesProblem({ type: "task", status: "pending", startsAt: "2026-10-12T09:00:00Z" }, now)).toBe("Minutes are written for meetings and calls.");
  });

  it("take a title, the text, up to 20 files of the meeting and whether the client sees them", () => {
    expect(parseMinutes(base)).toEqual({ ...base, title: "Kick-off", body: "Agreed the render sign-off by 20 Oct." });
    expect(() => parseMinutes({ ...base, body: "  " })).toThrow("Write the minutes.");
    expect(() => parseMinutes({ ...base, title: "" })).toThrow("Give the minutes a title.");
    expect(() => parseMinutes({ ...base, shared: undefined })).toThrow("Say whether the client sees the minutes.");
    expect(() => parseMinutes({ ...base, fileIds: Array.from({ length: 21 }, (_, index) => ID.replace(/.$/, index.toString(16).slice(-1)).replace(/^6f1c2a0e/, `6f1c2a${String(index).padStart(2, "0")}`)) }))
      .toThrow("up to 20 files");
    expect(() => parseMinutes({ ...base, fileIds: ["x"] })).toThrow("The files aren't valid.");
    expect(() => parseMinutes({ ...base, version: -1 })).toThrow("Reload");
  });

  it("show on the client's home as a card when shared", () => {
    const cards = feedCards({ progress: null, decisions: null, documents: null, payments: null, messages: null,
      meetings: { meetings: [{ id: "m1", title: "Kick-off meeting", sharedAt: "2026-10-13T10:00:00.000Z" }] } });
    expect(cards).toEqual([{ kind: "minutes", id: "m1", at: "2026-10-13T10:00:00.000Z", title: "Kick-off meeting", note: null, status: null }]);
  });

  it("remind the meeting's owner through the reminder engine, a few hours after it ended", () => {
    expect(minutesDueSource).toMatchObject({ kind: "meeting.minutes_due", module: "sales", audience: "staff", notify: "engine", template: { code: "reminders.meeting.minutes_due" } });
    expect(REMINDER_KIND_INFO["meeting.minutes_due"]).toMatchObject({ module: "sales", audience: "staff", critical: false });
    expect(REMINDER_KIND_DEFAULTS["meeting.minutes_due"]).toMatchObject({ offsets: [2, 24], unit: "hour", escalateAfter: 2 });
  });
});
