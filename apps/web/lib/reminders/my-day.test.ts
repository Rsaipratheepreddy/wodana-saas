import { describe, expect, it } from "vitest";
import { CalendarDate } from "@internationalized/date";
import type { MyDayItem, MyDayResponse } from "@wodana/contracts";
import { translatorFor } from "@/lib/i18n/keys";
import { offsetLabel } from "./labels";
import { dueLabel, latestSnooze, myDayRow, openCount, showCritical, snoozePresets, topMyDayItems, withoutItems } from "./my-day";

const t = translatorFor({});
const item = (id: string, overrides: Partial<MyDayItem> = {}): MyDayItem => ({
  id, kind: "work.due", module: "projects", title: id, context: "", href: "/workspace", dueAt: null, urgency: "today", critical: false, audience: "staff", owner: null,
  reminders: { sent: 0, escalationLevel: 0, nextAt: null }, snoozed: null, actions: ["open"], completeLabel: null, version: 1, ...overrides,
});
const response: MyDayResponse = {
  generatedAt: "", scope: "me", timeZone: "UTC", today: "2026-10-11", counts: { overdue: 1, today: 1, upcoming: 1, waiting: 1, snoozed: 1, total: 5 },
  groups: [
    { jobId: "j", jobReference: null, title: "Job", href: null, items: [item("up", { urgency: "upcoming", dueAt: "2026-10-13" }), item("wait", { urgency: "waiting", dueAt: "2026-10-01T08:00:00Z" })] },
    { jobId: null, jobReference: null, title: "", href: null, items: [item("late", { urgency: "overdue", dueAt: "2026-10-09" }), item("now", { dueAt: "2026-10-11T15:00:00Z" }), item("zz", { urgency: "snoozed", snoozed: { until: "2026-10-12T09:00:00Z", reason: "x" } })] },
  ],
};

describe("My day helpers", () => {
  it("puts late work first, then today's, then what waits, then what comes; snoozed items stay out", () => {
    expect(topMyDayItems(response, 6).map((entry) => entry.id)).toEqual(["late", "now", "wait", "up"]);
    expect(topMyDayItems(response, 2).map((entry) => entry.id)).toEqual(["late", "now"]);
    expect(openCount(response.counts)).toBe(4);
  });

  it("hides the items waiting for their undo window and lowers the counts", () => {
    const hidden = withoutItems(response, new Set(["up", "wait"]));
    expect(hidden.groups.map((group) => group.jobId)).toEqual([null]);
    expect(hidden.counts).toEqual({ overdue: 1, today: 1, upcoming: 0, waiting: 0, snoozed: 1, total: 3 });
    expect(withoutItems(response, new Set())).toBe(response);
  });

  it("says when each item is due in the person's zone", () => {
    const context = { today: "2026-10-11", timeZone: "UTC", locale: "en-GB", t };
    expect(dueLabel(item("a", { urgency: "overdue", dueAt: "2026-10-08" }), context)).toBe("3 days late");
    expect(dueLabel(item("b", { urgency: "overdue", dueAt: "2026-10-10T20:00:00Z" }), context)).toBe("1 day late");
    expect(dueLabel(item("c", { dueAt: "2026-10-11T15:00:00Z" }), context)).toBe("Today 15:00");
    expect(dueLabel(item("d", { urgency: "upcoming", dueAt: "2026-10-12" }), context)).toBe("Tomorrow");
    expect(dueLabel(item("e", { urgency: "upcoming", dueAt: "2026-10-14" }), context)).toBe("Wed 14 Oct");
    expect(dueLabel(item("f", { urgency: "waiting", dueAt: "2026-10-01T08:00:00Z" }), context)).toBe("Since Thu 1 Oct");
    // The same instant is already tomorrow for someone four hours ahead.
    expect(dueLabel(item("g", { dueAt: "2026-10-11T22:00:00Z" }), { ...context, timeZone: "Etc/GMT-4" })).toBe("Tomorrow 2:00");
    expect(dueLabel(item("h", { snoozed: { until: "2026-10-12T09:00:00Z", reason: "x" } }), context)).toBe("Snoozed until Mon 12 Oct 9:00");
  });

  it("offers snooze times that stay within 14 days, or the next working day for a critical item", () => {
    const now = new Date("2026-10-11T10:20:00Z");
    const latest = latestSnooze({ critical: false, timeZone: "UTC", nextWorkingDay: new CalendarDate(2026, 10, 12), now });
    expect(snoozePresets({ timeZone: "UTC", morning: "09:00", latest, now }).map((preset) => [preset.id, preset.until.toISOString()])).toEqual([
      ["later", "2026-10-11T14:00:00.000Z"], ["tomorrow", "2026-10-12T09:00:00.000Z"], ["next-week", "2026-10-18T09:00:00.000Z"],
    ]);
    const critical = latestSnooze({ critical: true, timeZone: "UTC", nextWorkingDay: new CalendarDate(2026, 10, 12), now });
    expect(critical.toISOString()).toBe("2026-10-12T23:59:00.000Z");
    expect(snoozePresets({ timeZone: "UTC", morning: "09:00", latest: critical, now }).map((preset) => preset.id)).toEqual(["later", "tomorrow"]);
    // Late in the evening there is no "later today".
    expect(snoozePresets({ timeZone: "UTC", morning: "09:00", latest, now: new Date("2026-10-11T22:00:00Z") }).map((preset) => preset.id)).toEqual(["tomorrow", "next-week"]);
  });

  it("titles each row with the job and puts the reference in the muted line", () => {
    const context = { t, locale: "en-GB", timeZone: "Asia/Dubai" };
    expect(myDayRow(item("i", { kind: "invoice.overdue", title: "PLM-INV-2026-00001 · PRJ-0002", context: "Reem Al Marzouqi · AED 18,963.00" }), context))
      .toEqual({ title: "Chase invoice · Reem Al Marzouqi · AED 18,963.00", detail: "PLM-INV-2026-00001 · PRJ-0002" });
    // A money reminder's title is "reference · party": the party is said once, in the row's title.
    expect(myDayRow(item("b", { kind: "payables.due", title: "INV-1 · Nile Marble", context: "Nile Marble · AED 367.00" }), context))
      .toEqual({ title: "Pay supplier bill · Nile Marble · AED 367.00", detail: "INV-1" });
    expect(myDayRow(item("o", { kind: "invoice.overdue", title: "PLM-INV-2026-00003 · Maya Client", context: "Maya Client · AED 1,200.00" }), context))
      .toEqual({ title: "Chase invoice · Maya Client · AED 1,200.00", detail: "PLM-INV-2026-00003" });
    expect(myDayRow(item("p", { kind: "payment.due", title: "On handover", context: "Omar and Layla Haddad · AED 4,359.60" }), context))
      .toEqual({ title: "Collect payment · Omar and Layla Haddad · AED 4,359.60", detail: "On handover" });
    expect(myDayRow(item("a", { kind: "approval.waiting", variant: "receipt", title: "On handover", context: "Omar and Layla Haddad" }), context))
      .toEqual({ title: "Verify payment · On handover", detail: "Omar and Layla Haddad" });
    expect(myDayRow(item("r", { kind: "approval.waiting", variant: "site_report", title: "2026-09-28", context: "Sam" }), context).title).toBe("Review site report · 28 Sept 2026");
    expect(myDayRow(item("s", { kind: "site.daily_report", title: "Daily site report", context: "PRJ-0004 · Penthouse", dueAt: "2026-10-09T14:00:00Z" }), context))
      .toEqual({ title: "Submit site report · 9 Oct", detail: "PRJ-0004 · Penthouse" });
    // A task already says the job: no action is added and nothing repeats.
    expect(myDayRow(item("w", { kind: "work.due", title: "#7 Book the lift", context: "PRJ-0002 · Marina" }), context)).toEqual({ title: "#7 Book the lift", detail: "PRJ-0002 · Marina" });
    expect(myDayRow(item("c", { kind: "crm.first_response", title: "Rashid", context: "Rashid" }), context)).toEqual({ title: "Respond to enquiry · Rashid", detail: "" });
  });

  it("shows Critical only on a critical item more than a week late", () => {
    expect(showCritical(item("a", { critical: true, urgency: "overdue", dueAt: "2026-10-03" }), "2026-10-11", "UTC")).toBe(true);
    expect(showCritical(item("b", { critical: true, urgency: "overdue", dueAt: "2026-10-05" }), "2026-10-11", "UTC")).toBe(false);
    expect(showCritical(item("c", { critical: false, urgency: "overdue", dueAt: "2026-09-01" }), "2026-10-11", "UTC")).toBe(false);
    expect(showCritical(item("d", { critical: true, urgency: "today", dueAt: "2026-10-11" }), "2026-10-11", "UTC")).toBe(false);
  });

  it("names cadence steps by days or hours", () => {
    expect([-3, -1, 0, 1, 2].map((offset) => offsetLabel(t, offset, "day"))).toEqual(["3 days before", "1 day before", "On the day", "1 day after", "2 days after"]);
    expect([0, 24, -2].map((offset) => offsetLabel(t, offset, "hour"))).toEqual(["At the time", "24 hours after", "2 hours before"]);
  });
});
