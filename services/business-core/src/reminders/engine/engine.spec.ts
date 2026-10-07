import { describe, expect, it } from "vitest";
import {
  capPriority, clientDayKey, clientQuietWindow, createSourceRegistry, effectiveRule, isTimeZone, localDate, nextOpenWindow, planSteps,
  resolveRecipientZone, type CapCandidate, type ReminderClock, type ReminderSource,
} from "./engine";
import { REMINDER_KIND_DEFAULTS, REMINDER_KIND_INFO } from "../reminders-contract";

const iso = (date: Date) => date.toISOString();
const at = (value: string) => new Date(value);
// Monday to Friday, 09:00, a Friday holiday.
const kolkata: ReminderClock = { timeZone: "Asia/Kolkata", start: "09:00", workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-16"] };

describe("planSteps", () => {
  it("fires day offsets at the start of the working day around the due date, keyed r:<offset>", () => {
    // Due Wednesday 14 Oct, 17:30 in Kolkata.
    const plan = planSteps(REMINDER_KIND_DEFAULTS["work.due"], at("2026-10-14T12:00:00Z"), kolkata);
    expect(plan).toMatchObject({ revision: 1, replanned: true, supersedes: null });
    expect(plan.steps.map((step) => [step.stepKey, iso(step.fireAt)])).toEqual([
      ["r:-1", "2026-10-13T03:30:00.000Z"],
      ["r:0", "2026-10-14T03:30:00.000Z"],
      ["r:1", "2026-10-15T03:30:00.000Z"],
      // Calendar days: a holiday doesn't move it.
      ["r:3", "2026-10-17T03:30:00.000Z"],
    ]);
    expect(plan.steps.every((step) => step.kind === "remind" && step.level === 0 && !step.stale)).toBe(true);
  });

  it("reads the due date in the workspace's zone", () => {
    // 20:00 UTC on the 14th is already 01:30 on the 15th in Kolkata.
    const plan = planSteps({ offsets: [0], unit: "day", workingDays: false }, at("2026-10-14T20:00:00Z"), kolkata);
    expect(iso(plan.steps[0].fireAt)).toBe("2026-10-15T03:30:00.000Z");
  });

  it("counts working days and skips holidays; a warning never lands after what it warns about", () => {
    const permit = REMINDER_KIND_DEFAULTS["permit.expiry"]; // −3wd, −1wd, 0
    // Due Monday 19 Oct: Friday 16 is a holiday, so −1 is Thursday 15 and −3 is Tuesday 13.
    expect(planSteps(permit, at("2026-10-19T06:00:00Z"), kolkata).steps.map((step) => localDate(step.fireAt, kolkata.timeZone)))
      .toEqual(["2026-10-13", "2026-10-15", "2026-10-19"]);
    // Due on Saturday 17: day 0 is the working day before it (Thursday 15).
    expect(planSteps(permit, at("2026-10-17T06:00:00Z"), kolkata).steps.map((step) => localDate(step.fireAt, kolkata.timeZone)))
      .toEqual(["2026-10-12", "2026-10-14", "2026-10-15"]);
    // Forward: one working day after Thursday 15 is Monday 19.
    expect(localDate(planSteps({ offsets: [1], unit: "day", workingDays: true }, at("2026-10-15T06:00:00Z"), kolkata).steps[0].fireAt, kolkata.timeZone))
      .toBe("2026-10-19");
  });

  it("fires hour offsets that many hours from the due moment", () => {
    const plan = planSteps(REMINDER_KIND_DEFAULTS["approval.waiting"], at("2026-10-14T10:15:00Z"), kolkata);
    expect(plan.steps.map((step) => [step.stepKey, iso(step.fireAt)])).toEqual([["r:24", "2026-10-15T10:15:00.000Z"], ["r:48", "2026-10-16T10:15:00.000Z"]]);
  });

  it("keeps local hours across a daylight-saving change", () => {
    const london: ReminderClock = { timeZone: "Europe/London", start: "09:00", workingDays: [1, 2, 3, 4, 5], holidays: [] };
    // Clocks go back on Sunday 25 Oct 2026: 09:00 is 08:00 UTC before, 09:00 UTC after.
    const plan = planSteps({ offsets: [-2, -1, 0], unit: "day", workingDays: false }, at("2026-10-26T12:00:00Z"), london);
    expect(plan.steps.map((step) => iso(step.fireAt))).toEqual(["2026-10-24T08:00:00.000Z", "2026-10-25T09:00:00.000Z", "2026-10-26T09:00:00.000Z"]);
  });

  it("keeps the revision while the due moment stands, and moves to the next when it changes", () => {
    const due = at("2026-10-14T12:00:00Z");
    const first = planSteps(REMINDER_KIND_DEFAULTS["work.due"], due, kolkata);
    const again = planSteps(REMINDER_KIND_DEFAULTS["work.due"], new Date(due), kolkata, { previous: { dueAt: due, revision: 1 } });
    expect(again).toMatchObject({ revision: 1, replanned: false, supersedes: null });
    expect(again.steps).toEqual(first.steps);
    const moved = planSteps(REMINDER_KIND_DEFAULTS["work.due"], at("2026-10-16T12:00:00Z"), kolkata, { previous: { dueAt: due, revision: 1 } });
    expect(moved).toMatchObject({ revision: 2, replanned: true, supersedes: 1 });
    expect(moved.steps.map((step) => step.stepKey)).toEqual(first.steps.map((step) => step.stepKey));
    expect(planSteps(REMINDER_KIND_DEFAULTS["work.due"], due, kolkata, { previous: { dueAt: null, revision: 3 } })).toMatchObject({ revision: 4, supersedes: 3 });
  });

  it("marks past steps stale except the latest, so a subject seen late doesn't send its history", () => {
    const plan = planSteps(REMINDER_KIND_DEFAULTS["work.due"], at("2026-10-14T12:00:00Z"), kolkata, { now: at("2026-10-16T00:00:00Z") });
    expect(plan.steps.map((step) => [step.stepKey, step.stale])).toEqual([["r:-1", true], ["r:0", true], ["r:1", false], ["r:3", false]]);
  });

  it("orders and de-duplicates offsets, and refuses an invalid due moment", () => {
    expect(planSteps({ offsets: [3, 0, 3, -1], unit: "day", workingDays: false }, at("2026-10-14T12:00:00Z"), kolkata).steps.map((step) => step.stepKey))
      .toEqual(["r:-1", "r:0", "r:3"]);
    expect(() => planSteps(REMINDER_KIND_DEFAULTS["work.due"], new Date("nope"), kolkata)).toThrow();
  });
});

describe("nextOpenWindow", () => {
  const night = { start: "20:00", end: "08:00" };

  it("holds a send made in quiet hours until they end in the recipient's zone", () => {
    // 22:30 in Kolkata → 08:00 the next morning there.
    expect(iso(nextOpenWindow(at("2026-10-14T17:00:00Z"), night, "Asia/Kolkata"))).toBe("2026-10-15T02:30:00.000Z");
    // 07:00 → 08:00 the same morning.
    expect(iso(nextOpenWindow(at("2026-10-15T01:30:00Z"), night, "Asia/Kolkata"))).toBe("2026-10-15T02:30:00.000Z");
    // Midday: now.
    expect(iso(nextOpenWindow(at("2026-10-15T06:30:00Z"), night, "Asia/Kolkata"))).toBe("2026-10-15T06:30:00.000Z");
    // The same instant is 18:00 in London: open there.
    expect(iso(nextOpenWindow(at("2026-10-14T17:00:00Z"), night, "Europe/London"))).toBe("2026-10-14T17:00:00.000Z");
    // A window inside one day.
    expect(iso(nextOpenWindow(at("2026-10-14T13:15:00Z"), { start: "13:00", end: "14:00" }, "UTC"))).toBe("2026-10-14T14:00:00.000Z");
  });

  it("is open now without quiet hours, or with an empty window", () => {
    const now = at("2026-10-14T17:00:00Z");
    expect(nextOpenWindow(now, null, "Asia/Kolkata").getTime()).toBe(now.getTime());
    expect(nextOpenWindow(now, { start: "20:00", end: "20:00" }, "Asia/Kolkata").getTime()).toBe(now.getTime());
  });

  it("sends to clients inside their window on working days only", () => {
    const window = clientQuietWindow({ start: "09:00", end: "18:00" });
    expect(window).toEqual({ start: "18:00", end: "09:00" });
    // Thursday 15 Oct 19:00 in Kolkata; Friday 16 is a holiday and the weekend is off → Monday 19 at 09:00.
    expect(iso(nextOpenWindow(at("2026-10-15T13:30:00Z"), window, "Asia/Kolkata", kolkata))).toBe("2026-10-19T03:30:00.000Z");
    // Wednesday 11:00: now.
    expect(iso(nextOpenWindow(at("2026-10-14T05:30:00Z"), window, "Asia/Kolkata", kolkata))).toBe("2026-10-14T05:30:00.000Z");
    // Wednesday 06:00: 09:00 the same day.
    expect(iso(nextOpenWindow(at("2026-10-14T00:30:00Z"), window, "Asia/Kolkata", kolkata))).toBe("2026-10-14T03:30:00.000Z");
  });
});

describe("resolveRecipientZone", () => {
  it("takes the person's setting, then the phone's, then the profile's (UTC = unset), then the workspace's", () => {
    expect(resolveRecipientZone("Europe/London", "Asia/Kolkata", "America/New_York", "Asia/Singapore")).toBe("Europe/London");
    expect(resolveRecipientZone(null, "Asia/Kolkata", "America/New_York", "Asia/Singapore")).toBe("Asia/Kolkata");
    expect(resolveRecipientZone("Not/AZone", "", "America/New_York", "Asia/Singapore")).toBe("America/New_York");
    expect(resolveRecipientZone(null, null, "UTC", "Asia/Singapore")).toBe("Asia/Singapore");
    expect(resolveRecipientZone(undefined, undefined, undefined, "Nowhere/Zone")).toBe("UTC");
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Asia/Nowhere")).toBe(false);
  });
});

describe("capPriority", () => {
  const candidate = (partyId: string, priority: number, key: string, extra: Partial<CapCandidate> = {}): CapCandidate =>
    ({ partyId, priority, localDate: "2026-10-14", fireAt: at("2026-10-14T05:00:00Z"), key, ...extra });

  it("sends one reminder per party per local day: payment before decision before other", () => {
    const result = capPriority([candidate("p1", 2, "quote"), candidate("p1", 1, "payment"), candidate("p1", 3, "other"), candidate("p2", 2, "design")]);
    expect(result.send.map((item) => item.key).sort()).toEqual(["design", "payment"]);
    expect(result.held.map((item) => item.key)).toEqual(["quote", "other"]);
  });

  it("breaks ties by the earliest, then the key, and treats each local day apart", () => {
    const result = capPriority([
      candidate("p1", 2, "b", { fireAt: at("2026-10-14T06:00:00Z") }), candidate("p1", 2, "a", { fireAt: at("2026-10-14T06:00:00Z") }),
      candidate("p1", 2, "early", { fireAt: at("2026-10-14T04:00:00Z") }), candidate("p1", 2, "tomorrow", { localDate: "2026-10-15" }),
    ]);
    expect(result.send.map((item) => item.key).sort()).toEqual(["early", "tomorrow"]);
    expect(result.held.map((item) => item.key)).toEqual(["a", "b"]);
  });

  it("holds everything for a party already reminded today, and lets transactional notices through uncounted", () => {
    const result = capPriority(
      [candidate("p1", 1, "payment"), candidate("p1", 2, "quote_issued", { transactional: true }), candidate("p2", 2, "quote"), candidate("p2", 9, "receipt", { transactional: true })],
      new Set([clientDayKey("p1", "2026-10-14")]),
    );
    expect(result.send.map((item) => item.key).sort()).toEqual(["quote", "quote_issued", "receipt"]);
    expect(result.held.map((item) => item.key)).toEqual(["payment"]);
  });
});

describe("effectiveRule", () => {
  const row = { enabled: false, offsets: [1, 2], unit: "day" as const, workingDays: false, escalateAfter: null, chain: [], channels: ["in_app" as const], digest: true, quietHours: null, version: 3 };

  it("uses the contract default when the firm has no row", () => {
    expect(effectiveRule("work.due", null)).toMatchObject({ kind: "work.due", enabled: true, offsets: [-1, 0, 1, 3], chain: ["manager", "owner"], version: 0 });
  });

  it("keeps a firm's choice, but a critical kind is always on and never only in the digest", () => {
    expect(effectiveRule("work.due", row)).toMatchObject({ enabled: false, offsets: [1, 2], digest: true, version: 3 });
    expect(effectiveRule("invoice.overdue", row)).toMatchObject({ enabled: true, offsets: [1, 2], digest: false, version: 3 });
  });
});

describe("source registry", () => {
  const source = (overrides: Partial<ReminderSource> = {}): ReminderSource => ({
    kind: "work.due", ...REMINDER_KIND_INFO["work.due"], viewPermission: "projects.view",
    open: async () => [], stillOpen: async () => new Set(), template: { code: "reminders.work.due" }, ...overrides,
  }) as ReminderSource;

  it("holds one source per kind that agrees with the contract", () => {
    expect(createSourceRegistry([source()]).get("work.due")?.viewPermission).toBe("projects.view");
    expect(() => createSourceRegistry([source(), source()])).toThrow("Two reminder sources");
    expect(() => createSourceRegistry([source({ critical: true })])).toThrow("critical");
    expect(() => createSourceRegistry([source({ kind: "payment.due", ...REMINDER_KIND_INFO["payment.due"] })])).toThrow("deliverClient");
    const client = source({ kind: "payment.due", ...REMINDER_KIND_INFO["payment.due"], deliverClient: async () => ({ status: "queued", notificationId: null, reason: null }) });
    expect(createSourceRegistry([client]).has("payment.due")).toBe(true);
  });
});
