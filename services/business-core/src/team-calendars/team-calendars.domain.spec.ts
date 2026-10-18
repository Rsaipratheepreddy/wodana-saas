import { describe, expect, it } from "vitest";
import { assigneeProblem, bookingDays, bookingProblem, entryFingerprint, pushPlan, rangeProblem, type TeamEntry } from "./team-calendars.domain";

const entry = (key: string, start: string, patch: Partial<TeamEntry> = {}): TeamEntry => ({
  key, kind: "render", recordId: key, subject: "Villa 12", detail: null, start, end: start, allDay: true, days: 3, status: "booked", overdue: false, ownerName: "Vic", href: "/x", ...patch,
});

describe("render and 2D bookings (PLM-090)", () => {
  it("run the firm's working days: a Sunday–Thursday week skips Friday and Saturday", () => {
    const week = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
    // Thursday 8 Oct 2026 + 3 working days: Thu, Sun, Mon.
    expect(bookingDays("2026-10-08", 3, week)).toEqual({ startsOn: "2026-10-08", dueOn: "2026-10-12" });
    // Asked for a Friday: it starts on the Sunday.
    expect(bookingDays("2026-10-09", 1, week)).toEqual({ startsOn: "2026-10-11", dueOn: "2026-10-11" });
  });

  it("skip holidays", () => {
    expect(bookingDays("2026-10-05", 2, { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-06"] })).toEqual({ startsOn: "2026-10-05", dueOn: "2026-10-07" });
  });

  it("are validated", () => {
    expect(bookingProblem({ kind: "render", startsOn: "2026-10-05", days: 5 })).toBeNull();
    expect(bookingProblem({ kind: "design_2d", startsOn: "2026-10-05", days: 2 })).toBeNull();
    expect(bookingProblem({ kind: "video", startsOn: "2026-10-05", days: 5 })).toBe("Choose 2D design drawings, a 3D render or technical drawings");
    expect(bookingProblem({ kind: "drawing", startsOn: "5 Oct", days: 5 })).toBe("Choose the day it starts");
    expect(bookingProblem({ kind: "drawing", startsOn: "2026-10-05", days: 0 })).toBe("Days are between 1 and 60");
  });

  it("go to the right people: the job's designers, a Visualiser, the technical team; anyone when nobody holds the role (PLM-177)", () => {
    expect(assigneeProblem("design_2d", "dana", ["dana", "jules"])).toBeNull();
    expect(assigneeProblem("design_2d", "vic", ["dana", "jules"])).toBe("Tag an Interior Designer on this job");
    expect(assigneeProblem("render", "dana", ["vic"])).toBe("Tag a Visualiser");
    expect(assigneeProblem("drawing", "vic", ["tariq"])).toBe("Tag the technical team");
    expect(assigneeProblem("drawing", "vic", [])).toBeNull();
  });
});

describe("the team calendar range", () => {
  it("is two days in order, at most 100 days apart", () => {
    expect(rangeProblem("2026-10-01", "2026-11-08")).toBeNull();
    expect(rangeProblem("2026-10-08", "2026-10-01")).toBe("Choose a valid range");
    expect(rangeProblem("2026-01-01", "2026-12-31")).toBe("Choose a range of at most 100 days");
  });
});

describe("the Google push plan", () => {
  const window = { from: "2026-10-01", to: "2026-12-31" };
  it("creates new entries, updates changed ones, leaves unchanged ones and cancels gone ones inside the window", () => {
    const same = entry("booking:a", "2026-10-10"), moved = entry("booking:b", "2026-10-12"), fresh = entry("booking:c", "2026-10-11");
    const pushed = [
      { entryKey: "booking:a", eventId: "ea", etag: "1", fingerprint: entryFingerprint(same), startsOn: "2026-10-10" },
      { entryKey: "booking:b", eventId: "eb", etag: "2", fingerprint: entryFingerprint({ ...moved, start: "2026-10-05" }), startsOn: "2026-10-05" },
      { entryKey: "booking:gone", eventId: "eg", etag: "3", fingerprint: "f".repeat(32), startsOn: "2026-10-20" },
      { entryKey: "booking:old", eventId: "eo", etag: "4", fingerprint: "f".repeat(32), startsOn: "2026-09-01" },
    ];
    const plan = pushPlan([same, moved, fresh], pushed, window, "Asia/Dubai");
    expect(plan.create.map((item) => item.key)).toEqual(["booking:c"]);
    expect(plan.update.map((item) => [item.key, item.eventId, item.etag])).toEqual([["booking:b", "eb", "2"]]);
    // An event outside the window is not "gone", only not looked at.
    expect(plan.cancel.map((item) => item.entryKey)).toEqual(["booking:gone"]);
  });

  it("does not resend an entry only because it became overdue", () => {
    const before = entry("booking:a", "2026-10-10");
    expect(entryFingerprint({ ...before, overdue: true } as TeamEntry)).toBe(entryFingerprint(before));
    expect(entryFingerprint({ ...before, status: "done" })).not.toBe(entryFingerprint(before));
  });
});
