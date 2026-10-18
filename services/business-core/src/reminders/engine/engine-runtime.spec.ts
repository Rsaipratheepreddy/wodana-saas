import { describe, expect, it } from "vitest";
import { staffSendAt } from "../delivery/staff-router";
import type { StaffPerson } from "../delivery/people";
import { digestDue, digestLines } from "../digest/digest";
import { parseMyDayQuery } from "../my-day/my-day.controller";
import { urgencyOf, type MyDayResponse } from "../my-day/my-day";
import { REMINDER_KIND_DEFAULTS } from "../reminders-contract";
import { validatePersonSettings, validateRule, validateSettings } from "../settings/settings";
import { ReminderSourceRegistryService } from "../sources/registry.service";
import { BUILTIN_REMINDER_SOURCES } from "../sources/index";
import { money } from "../sources/support";
import { effectiveRule, planSteps, type ReminderClock } from "./engine";
import { planKeyOf, stepsToWrite, CATCH_UP_MS } from "./plan";
import { dueText } from "./text";

const DUBAI: ReminderClock = { timeZone: "Asia/Dubai", start: "09:00", workingDays: [1, 2, 3, 4, 5], holidays: [] };
const at = (iso: string) => new Date(iso);
const person = (patch: Partial<StaffPerson> = {}): StaffPerson => ({
  membershipId: "m", userId: "u", name: "Sara", timeZone: "Asia/Dubai", quiet: { start: "20:00", end: "08:00" }, ownQuiet: false, digestEnabled: true, digestTime: "08:00",
  pushReachable: true, ...patch,
});
const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] as string[] };

describe("due phrases", () => {
  it("say when in the recipient's zone, and how long something has waited", () => {
    const now = at("2030-01-09T10:00:00Z"); // Wed 14:00 Dubai
    expect(dueText(at("2030-01-09T05:00:00Z"), now, "Asia/Dubai", false)).toBe("due today");
    expect(dueText(at("2030-01-10T05:00:00Z"), now, "Asia/Dubai", false)).toBe("due tomorrow");
    expect(dueText(at("2030-01-12T05:00:00Z"), now, "Asia/Dubai", false)).toBe("due in 3 days");
    expect(dueText(at("2030-01-08T05:00:00Z"), now, "Asia/Dubai", false)).toBe("1 day overdue");
    expect(dueText(at("2030-01-05T05:00:00Z"), now, "Asia/Dubai", false)).toBe("4 days overdue");
    // 23:30 UTC on the 8th is already the 9th in Dubai, still the 8th (yesterday) in New York.
    expect(dueText(at("2030-01-08T23:30:00Z"), now, "Asia/Dubai", false)).toBe("due today");
    expect(dueText(at("2030-01-08T23:30:00Z"), now, "America/New_York", false)).toBe("1 day overdue");
    expect(dueText(at("2030-01-08T08:00:00Z"), now, "Asia/Dubai", true)).toBe("waiting 26 hours");
    expect(dueText(at("2030-01-06T10:00:00Z"), now, "Asia/Dubai", true)).toBe("waiting 3 days");
  });
});

describe("planning", () => {
  const rule = effectiveRule("work.due", null);
  it("writes the future steps and only the latest missed one on a revision's first plan, within the catch-up window", () => {
    const plan = planSteps(rule, at("2030-01-09T05:00:00Z"), DUBAI, { now: at("2030-01-10T12:00:00Z") });
    expect(stepsToWrite(plan.steps, at("2030-01-10T12:00:00Z"), true).map((step) => step.stepKey)).toEqual(["r:1", "r:3"]);
    // Planned again for the same revision (the rule changed): only what is still ahead.
    expect(stepsToWrite(plan.steps, at("2030-01-10T12:00:00Z"), false).map((step) => step.stepKey)).toEqual(["r:3"]);
    // Seen a month late: nothing old is sent.
    const late = planSteps(rule, at("2029-12-01T05:00:00Z"), DUBAI, { now: at("2030-01-10T12:00:00Z") });
    expect(stepsToWrite(late.steps, at("2030-01-10T12:00:00Z"), true)).toEqual([]);
    expect(CATCH_UP_MS).toBe(7 * 86_400_000);
  });

  it("plans again when the due revision or the rule's cadence changes", () => {
    const key = planKeyOf(1, rule);
    expect(planKeyOf(1, rule)).toBe(key);
    expect(planKeyOf(2, rule)).not.toBe(key);
    expect(planKeyOf(1, { ...rule, offsets: [0, 1] })).not.toBe(key);
    expect(planKeyOf(1, { ...rule, enabled: false })).not.toBe(key);
    expect(planKeyOf(1, { ...rule, workingDays: true })).not.toBe(key);
    expect(key.length).toBeLessThanOrEqual(40);
  });
});

describe("quiet hours and working days for staff pushes and emails", () => {
  const options = { critical: false, criticalBreaksQuiet: false, ruleQuiet: null, calendar };
  it("hold until the end of each person's quiet hours, in their own zone", () => {
    const now = at("2030-01-09T17:00:00Z"); // 22:30 in Kolkata, 12:00 in New York
    expect(staffSendAt(person({ timeZone: "Asia/Kolkata", quiet: { start: "22:00", end: "07:00" }, ownQuiet: true }), now, options).toISOString()).toBe("2030-01-10T01:30:00.000Z");
    expect(staffSendAt(person({ timeZone: "America/New_York", quiet: { start: "22:00", end: "07:00" }, ownQuiet: true }), now, options)).toEqual(now);
  });

  it("use the rule's quiet hours for people without their own, and wait for a working day", () => {
    const friday = at("2030-01-11T19:00:00Z"); // Friday 23:00 Dubai
    expect(staffSendAt(person(), friday, options).toISOString()).toBe("2030-01-14T04:00:00.000Z"); // Monday 08:00
    expect(staffSendAt(person(), at("2030-01-09T10:00:00Z"), { ...options, ruleQuiet: { start: "13:00", end: "15:00" } }).toISOString()).toBe("2030-01-09T11:00:00.000Z");
    // Their own quiet hours win over the rule's.
    expect(staffSendAt(person({ ownQuiet: true }), at("2030-01-09T10:00:00Z"), { ...options, ruleQuiet: { start: "13:00", end: "15:00" } })).toEqual(at("2030-01-09T10:00:00Z"));
  });

  it("let a critical item through at weekends, and through quiet hours when the firm says so", () => {
    const friday = at("2030-01-11T19:00:00Z");
    expect(staffSendAt(person(), friday, { ...options, critical: true }).toISOString()).toBe("2030-01-12T04:00:00.000Z"); // Saturday 08:00
    expect(staffSendAt(person(), friday, { ...options, critical: true, criticalBreaksQuiet: true })).toEqual(friday);
    expect(staffSendAt(person(), friday, { ...options, criticalBreaksQuiet: true }).toISOString()).toBe("2030-01-14T04:00:00.000Z");
  });
});

describe("My day", () => {
  const now = at("2030-01-09T10:00:00Z");
  const subject = (patch: Record<string, unknown>) => ({ kind: "work.due", status: "open", snoozedUntil: null, dueAt: at("2030-01-09T05:00:00Z"), remindersSent: 0, ...patch }) as Parameters<typeof urgencyOf>[0];
  it("sorts items into overdue, today, waiting, coming (once a reminder went) and snoozed", () => {
    expect(urgencyOf(subject({}), now, "Asia/Dubai")).toBe("today");
    expect(urgencyOf(subject({ dueAt: at("2030-01-07T05:00:00Z") }), now, "Asia/Dubai")).toBe("overdue");
    expect(urgencyOf(subject({ dueAt: at("2030-01-10T05:00:00Z") }), now, "Asia/Dubai")).toBeNull();
    expect(urgencyOf(subject({ dueAt: at("2030-01-10T05:00:00Z"), remindersSent: 1 }), now, "Asia/Dubai")).toBe("upcoming");
    expect(urgencyOf(subject({ kind: "approval.waiting", dueAt: at("2030-01-01T05:00:00Z") }), now, "Asia/Dubai")).toBe("waiting");
    expect(urgencyOf(subject({ status: "snoozed", snoozedUntil: at("2030-01-10T05:00:00Z") }), now, "Asia/Dubai")).toBe("snoozed");
    // A snooze that ran out shows the item again.
    expect(urgencyOf(subject({ status: "snoozed", snoozedUntil: at("2030-01-09T05:00:00Z") }), now, "Asia/Dubai")).toBe("today");
  });

  it("checks its query", () => {
    expect(parseMyDayQuery({})).toEqual({ scope: "me", urgency: undefined, module: undefined, limit: undefined });
    expect(parseMyDayQuery({ scope: "team", urgency: "overdue", module: "finance", limit: "50" })).toEqual({ scope: "team", urgency: "overdue", module: "finance", limit: 50 });
    expect(() => parseMyDayQuery({ scope: "all" })).toThrow(/Scope/);
    expect(() => parseMyDayQuery({ urgency: "later" })).toThrow(/urgency/);
    expect(() => parseMyDayQuery({ module: "hr" })).toThrow(/module/);
    expect(() => parseMyDayQuery({ limit: "0" })).toThrow(/Limit/);
  });
});

describe("the digest", () => {
  it("is due at the person's time, in their zone, on working days only", () => {
    const wednesday = at("2030-01-09T04:05:00Z"); // 08:05 Dubai
    expect(digestDue(person(), wednesday, calendar)).toBe("2030-01-09");
    expect(digestDue(person(), at("2030-01-09T03:55:00Z"), calendar)).toBeNull();
    expect(digestDue(person({ digestEnabled: false }), wednesday, calendar)).toBeNull();
    expect(digestDue(person(), wednesday, { ...calendar, holidays: ["2030-01-09"] })).toBeNull();
    expect(digestDue(person(), at("2030-01-12T05:00:00Z"), calendar)).toBeNull(); // Saturday
    expect(digestDue(person({ timeZone: "Asia/Kolkata", digestTime: "09:30" }), wednesday, calendar)).toBe("2030-01-09"); // 09:35 in Kolkata
    expect(digestDue(person({ timeZone: "Asia/Kolkata", digestTime: "09:40" }), wednesday, calendar)).toBeNull();
  });

  it("lists at most ten items, grouped by job", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, title: `Item ${index}`, dueAt: "2030-01-08T05:00:00.000Z", urgency: "overdue", critical: index === 0 }));
    const day = { timeZone: "Asia/Dubai", groups: [{ title: "J-000001 Villa", items: items.slice(0, 6) }, { title: "", items: items.slice(6) }] } as unknown as MyDayResponse;
    const lines = digestLines(day, at("2030-01-09T05:00:00Z")).split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe("• J-000001 Villa: Item 0 (1 day overdue) · critical");
    expect(lines[9]).toBe("• Item 9 (1 day overdue)");
  });
});

describe("rules and settings", () => {
  const input = (kind: keyof typeof REMINDER_KIND_DEFAULTS, patch: Record<string, unknown> = {}) => {
    const defaults = REMINDER_KIND_DEFAULTS[kind];
    return { enabled: true, offsets: [...defaults.offsets], unit: defaults.unit, workingDays: defaults.workingDays, escalateAfter: defaults.escalateAfter,
      chain: [...defaults.chain], channels: [...defaults.channels], digest: false, quietHours: null, version: 0, ...patch } as Parameters<typeof validateRule>[1];
  };
  it("keep a critical kind on and in the app, and never only in the digest", () => {
    expect(() => validateRule("invoice.overdue", input("invoice.overdue", { enabled: false }))).toThrow(/always on/);
    expect(() => validateRule("invoice.overdue", input("invoice.overdue", { channels: ["email"] }))).toThrow(/in the app/);
    expect(() => validateRule("invoice.overdue", input("invoice.overdue", { digest: true }))).toThrow(/digest/);
    expect(validateRule("work.due", input("work.due", { enabled: false, digest: true })).enabled).toBe(false);
  });

  it("check offsets, the chain and the audience's channels", () => {
    expect(validateRule("work.due", input("work.due", { offsets: [3, -1, 0, 0] })).offsets).toEqual([-1, 0, 3]);
    expect(() => validateRule("work.due", input("work.due", { offsets: [1, 2, 3, 4, 5, 6, 7] }))).toThrow(/at most 6/);
    expect(() => validateRule("work.due", input("work.due", { offsets: [91] }))).toThrow(/up to 90/);
    expect(validateRule("approval.waiting", input("approval.waiting", { offsets: [12, 720] })).offsets).toEqual([12, 720]);
    expect(() => validateRule("work.due", input("work.due", { chain: ["owner", "owner"] }))).toThrow(/once/);
    expect(() => validateRule("work.due", input("work.due", { chain: ["manager", "finance", "purchasing", "owner"] }))).toThrow(/at most 3/);
    expect(() => validateRule("work.due", input("work.due", { channels: ["whatsapp"] }))).toThrow(/in the app/);
    expect(() => validateRule("payment.due", input("payment.due", { channels: ["push"] }))).toThrow(/WhatsApp/);
    expect(() => validateRule("work.due", input("work.due", { escalateAfter: 7 }))).toThrow(/1 to 6/);
    expect(validateRule("work.due", input("work.due", { quietHours: { start: "21:00", end: "07:00" } })).quietHours).toEqual({ start: "21:00", end: "07:00" });
  });

  it("check the firm's settings and a person's", () => {
    const firm = { quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00", clientWindow: null, criticalBreaksQuiet: false, version: 0 };
    expect(validateSettings(firm)).toEqual({ quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00", clientWindow: null, criticalBreaksQuiet: false });
    expect(() => validateSettings({ ...firm, clientWindow: { start: "18:00", end: "09:00" } })).toThrow(/after it starts/);
    expect(() => validateSettings({ ...firm, digestTime: "8am" })).toThrow(/HH:MM/);
    const mine = { digestEnabled: true, digestTime: null, quietHours: null, timeZone: "Asia/Kolkata", version: 0 };
    expect(validatePersonSettings(mine).timeZone).toBe("Asia/Kolkata");
    expect(() => validatePersonSettings({ ...mine, timeZone: "Mars/Olympus" })).toThrow(/time zone/);
    expect(() => validatePersonSettings({ ...mine, quietHours: { start: "22:00", end: "22:00" } })).toThrow(/differ/);
  });
});

describe("the source registry", () => {
  it("has one built-in source per kind but change requests, agreeing with the contract", () => {
    const registry = new ReminderSourceRegistryService().registry();
    expect(registry.size).toBe(BUILTIN_REMINDER_SOURCES.length);
    expect(registry.has("change_request.client_decision")).toBe(false);
    for (const source of registry.values()) if (source.audience === "client" && source.notify === "engine") expect(source.deliverClient, source.kind).toBeTypeOf("function");
  });

  it("lets a module register its own source once, and attach its commands", () => {
    const service = new ReminderSourceRegistryService();
    const source = { kind: "change_request.client_decision" as const, module: "projects" as const, audience: "client" as const, critical: false, notify: "engine" as const,
      viewPermission: "projects.view", template: { code: "reminders.change_request.client_decision" }, open: async () => [], stillOpen: async () => new Set<string>(),
      deliverClient: async () => ({ status: "skipped" as const, channel: null, notificationIds: [], reason: null }) };
    service.register(source);
    expect(service.registry().get("change_request.client_decision")).toBeTruthy();
    expect(() => service.register(source)).toThrow(/Two reminder sources/);
    expect(() => service.register({ ...source, kind: "payment.due" as never, critical: false })).toThrow();
    service.attachCommands("work.due", { complete: { label: "Mark done", permission: "projects.view", run: async () => undefined } });
    expect(service.registry().get("work.due")?.complete?.label).toBe("Mark done");
  });
});

describe("money in reminders", () => {
  it("is exact, in the currency's places", () => {
    expect(money("AED", "12500.5")).toBe("AED 12,500.50");
    expect(money("KWD", "1.2345")).toBe("KWD 1.235");
    expect(money("JPY", "1500.4")).toBe("JPY 1,500");
  });
});

describe("WhatsApp opt-out", () => {
  it("withdraws consent only for a message that is just an opt-out word", async () => {
    const { WHATSAPP_OPT_OUT } = await import("../../crm/conversations/crm-conversations.service");
    for (const text of ["STOP", " stop ", "Stop.", "unsubscribe", "Opt out", "STOP ALL"]) expect(WHATSAPP_OPT_OUT.test(text), text).toBe(true);
    for (const text of ["Please don't stop the work", "stop by tomorrow?", "", "Thanks"]) expect(WHATSAPP_OPT_OUT.test(text), text).toBe(false);
  });
});
