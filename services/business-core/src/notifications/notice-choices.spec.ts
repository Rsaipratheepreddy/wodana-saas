import { describe, expect, it, vi } from "vitest";
import { staffSendAt } from "../reminders/delivery/staff-router";
import type { StaffPerson } from "../reminders/delivery/people";
import { decideChannel, defaultNoticeChoices, noticeGroup, planNotice, readNoticeChoices, resolveSwitches, type NoticeChoices } from "./notice-choices";
import { validateChoices } from "./notice-choices.service";

const at = (iso: string) => new Date(iso);
const reachable: NoticeChoices["reach"] = { in_app: "ok", email: "ok", whatsapp: "destination_missing", push: "ok" };
const person = (patch: Partial<NoticeChoices> = {}): NoticeChoices => ({
  userId: "u", membershipId: "m", group: "projects", switches: {}, quiet: null, timeZone: null,
  workspaceChannels: ["in_app", "email", "push"], reach: reachable, ...patch,
});
const now = at("2030-01-09T10:00:00Z");

describe("notice groups", () => {
  it("name each event's group like the settings page does", () => {
    expect(noticeGroup("crm.lead.assigned")).toBe("sales");
    expect(noticeGroup("quotation.review_requested")).toBe("planning");
    expect(noticeGroup("site.report_missing")).toBe("projects");
    expect(noticeGroup("purchasing.approval_needed")).toBe("operations");
    expect(noticeGroup("petty_cash.submitted")).toBe("finance");
    expect(noticeGroup("books.lock_moved")).toBe("ledger");
    expect(noticeGroup("hrms.leave_requested")).toBe("people");
    expect(noticeGroup("approvals.waiting")).toBe("workspace");
    expect(noticeGroup(undefined)).toBe("workspace");
  });
});

describe("each person's switches", () => {
  const event = "crm.lead.assigned";
  it("turn a channel off for a group; nothing saved means on", () => {
    expect(resolveSwitches(event, {}, [])).toEqual({});
    expect(resolveSwitches(event, { email: false, in_app: true }, [])).toEqual({ email: false, in_app: true });
  });

  it("let a mute of one kind of notice, or a family of it, win over the group; the group wins over older prefix switches", () => {
    expect(resolveSwitches(event, { email: true }, [{ eventType: event, channel: "email", enabled: false }]).email).toBe(false);
    expect(resolveSwitches(event, { email: false }, [{ eventType: event, channel: "email", enabled: true }]).email).toBe(true);
    expect(resolveSwitches(event, { in_app: true }, [{ eventType: "crm.lead.*", channel: "in_app", enabled: false }]).in_app).toBe(false);
    expect(resolveSwitches(event, { in_app: true }, [{ eventType: "crm.*", channel: "in_app", enabled: false }]).in_app).toBe(true);
    expect(resolveSwitches(event, {}, [{ eventType: "crm.*", channel: "in_app", enabled: false }]).in_app).toBe(false);
    // Another kind of notice, or another module's family, doesn't count.
    expect(resolveSwitches(event, {}, [{ eventType: "crm.lead_unowned", channel: "in_app", enabled: false }, { eventType: "site.*", channel: "in_app", enabled: false }])).toEqual({});
  });

  it("read '*' as everything for the app and email, and as the phone's own switch (not a mute) for push", () => {
    expect(resolveSwitches(event, {}, [{ eventType: "*", channel: "email", enabled: false }]).email).toBe(false);
    expect(resolveSwitches(event, { email: true }, [{ eventType: "*", channel: "email", enabled: false }]).email).toBe(true);
    expect(resolveSwitches(event, {}, [{ eventType: "*", channel: "push", enabled: false }]).push).toBeUndefined();
  });

  it("decide a channel: off, not turned on by the workspace, or not reachable", () => {
    expect(decideChannel(person({ switches: { email: false } }), "email", { critical: false, now })).toEqual({ channel: "email", send: false, reason: "recipient_preference" });
    expect(decideChannel(person({ workspaceChannels: ["in_app", "email"] }), "push", { critical: false, now })).toEqual({ channel: "push", send: false, reason: "channel_off" });
    expect(decideChannel(person({ reach: { ...reachable, push: "push_off" } }), "push", { critical: false, now })).toMatchObject({ send: false, reason: "push_off" });
    expect(decideChannel(person({ workspaceChannels: ["in_app", "email", "whatsapp"] }), "whatsapp", { critical: false, now })).toMatchObject({ send: false, reason: "destination_missing" });
    expect(decideChannel(person(), "email", { critical: false, now })).toEqual({ channel: "email", send: true, at: now, held: false, silent: false });
  });

  it("check a saved grid", () => {
    expect(validateChoices([{ group: "sales", channel: "email", enabled: false }])).toEqual([{ group: "sales", channel: "email", enabled: false }]);
    expect(() => validateChoices([{ group: "sales", channel: "fax", enabled: false }])).toThrow();
    expect(() => validateChoices([{ group: "sales", channel: "email", enabled: false }, { group: "sales", channel: "email", enabled: true }])).toThrow();
  });
});

describe("alerts can't be muted", () => {
  const off = { in_app: false, email: false, push: false, whatsapp: false };
  it("land in the app and go by the fastest channel the person can be reached on, whatever they chose", () => {
    const plan = planNotice(person({ switches: off }), { channels: ["in_app"], available: ["in_app", "push", "email"], critical: true, now });
    expect(plan.sends.map((send) => [send.channel, send.forced ?? false])).toEqual([["in_app", false], ["push", true]]);
    // No phone: email is the fastest left. No push template: email too.
    expect(planNotice(person({ switches: off, reach: { ...reachable, push: "no_device" } }), { channels: ["in_app"], available: ["in_app", "push", "email"], critical: true, now })
      .sends.map((send) => send.channel)).toEqual(["in_app", "email"]);
    expect(planNotice(person({ switches: off }), { channels: ["in_app", "email"], available: ["in_app", "email"], critical: true, now }).sends.map((send) => send.channel)).toEqual(["in_app", "email"]);
    // Not critical: nothing goes.
    const muted = planNotice(person({ switches: off }), { channels: ["in_app", "push", "email"], critical: false, now });
    expect(muted.sends).toEqual([]);
    expect(muted.skipped.every((skip) => skip.reason === "recipient_preference")).toBe(true);
  });

  it("are never held by the person's own quiet hours, and never land silently", () => {
    const night = person({ quiet: { start: "22:00", end: "07:00" }, timeZone: "Asia/Kolkata" });
    const late = at("2030-01-09T18:00:00Z"); // 23:30 in Kolkata
    const plan = planNotice(night, { channels: ["in_app", "email"], critical: true, now: late });
    expect(plan.sends.map((send) => [send.channel, send.at.toISOString(), send.silent])).toEqual([
      ["in_app", late.toISOString(), false], ["email", late.toISOString(), false], ["push", late.toISOString(), false]]);
  });
});

describe("quiet hours", () => {
  const night = (zone: string) => person({ quiet: { start: "22:00", end: "07:00" }, timeZone: zone });

  it("hold email and push until they end, across midnight, in a non-UTC zone; the in-app notice lands now, silently", () => {
    const late = at("2030-01-09T18:00:00Z"); // 23:30 in Kolkata
    const plan = planNotice(night("Asia/Kolkata"), { channels: ["in_app", "email", "push"], critical: false, now: late });
    expect(plan.sends.map((send) => [send.channel, send.at.toISOString(), send.held, send.silent])).toEqual([
      ["in_app", late.toISOString(), false, true],
      ["email", "2030-01-10T01:30:00.000Z", true, false], // 07:00 the next morning in Kolkata
      ["push", "2030-01-10T01:30:00.000Z", true, false],
    ]);
    // After midnight, still inside: released at 07:00 the same local day.
    expect(decideChannel(night("Asia/Kolkata"), "email", { critical: false, now: at("2030-01-09T20:30:00Z") })).toMatchObject({ held: true, at: at("2030-01-10T01:30:00.000Z") });
  });

  it("release at once outside them, and follow the person's zone (a summer-time zone too)", () => {
    expect(decideChannel(night("Asia/Kolkata"), "email", { critical: false, now: at("2030-01-09T06:30:00Z") })).toMatchObject({ held: false, at: at("2030-01-09T06:30:00Z") });
    // 23:00 in New York in July (UTC−4) is 03:00 UTC: held until 07:00 there, 11:00 UTC.
    expect(decideChannel(night("America/New_York"), "push", { critical: false, now: at("2030-07-10T03:00:00Z") })).toMatchObject({ held: true, at: at("2030-07-10T11:00:00.000Z") });
    // The same instant is 05:00 in Lisbon (summer, UTC+1): still quiet, until 07:00 there.
    expect(decideChannel(night("Europe/Lisbon"), "push", { critical: false, now: at("2030-07-10T03:00:00Z") })).toMatchObject({ held: true, at: at("2030-07-10T06:00:00.000Z") });
    // Hours within one day.
    expect(decideChannel(person({ quiet: { start: "13:00", end: "14:00" }, timeZone: "Asia/Dubai" }), "email", { critical: false, now: at("2030-01-09T09:15:00Z") }))
      .toMatchObject({ held: true, at: at("2030-01-09T10:00:00.000Z") });
  });

  it("for the reminder engine: the firm's hours hold an alert only when the firm says so; the person's own never do", () => {
    const staff = (patch: Partial<StaffPerson> = {}): StaffPerson => ({ membershipId: "m", userId: "u", name: "Sara", timeZone: "Asia/Dubai", quiet: { start: "20:00", end: "08:00" },
      ownQuiet: false, firmQuiet: { start: "20:00", end: "08:00" }, digestEnabled: true, digestTime: "08:00", pushReachable: true, ...patch });
    const options = { critical: true, criticalBreaksQuiet: false, ruleQuiet: null, calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] } };
    const evening = at("2030-01-09T17:00:00Z"); // 21:00 in Dubai
    expect(staffSendAt(staff(), evening, options).toISOString()).toBe("2030-01-10T04:00:00.000Z");
    // Own quiet hours 22:00–07:00 don't hold the alert; the firm's 20:00–08:00 still do.
    expect(staffSendAt(staff({ quiet: { start: "22:00", end: "07:00" }, ownQuiet: true }), evening, options).toISOString()).toBe("2030-01-10T04:00:00.000Z");
    expect(staffSendAt(staff({ quiet: { start: "22:00", end: "07:00" }, ownQuiet: true, firmQuiet: null }), evening, options)).toEqual(evening);
    expect(staffSendAt(staff(), evening, { ...options, criticalBreaksQuiet: true })).toEqual(evening);
  });
});

describe("reading the choices", () => {
  it("reads every switch for the notice in one query and puts quiet hours in the workspace's region zone when the person has none", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push(sql);
      if (sql.includes("FROM notification_channel_choices")) {
        expect(values.slice(2)).toEqual(["sales", "crm.lead.assigned"]);
        return { rows: [{ userId: "u", membershipId: "m", groupSwitches: { email: false }, eventSwitches: [{ eventType: "crm.lead.assigned", channel: "in_app", enabled: false }],
          pushSwitch: true, pushDevice: true, quietStart: "21:00:00", quietEnd: "06:30:00", personZone: null, deviceZone: null, preferredZone: "UTC", workspacePush: true, workspaceWhatsapp: true }] };
      }
      if (sql.includes('"regionTimeZone"')) return { rows: [{ timeZone: null, regionTimeZone: "Europe/Lisbon", calendarTimeZone: null, start: null, end: null }] };
      return { rows: [] };
    });
    const choices = (await readNoticeChoices({ query }, "w", ["u", "u"], "crm.lead.assigned")).get("u");
    expect(choices).toEqual({ userId: "u", membershipId: "m", group: "sales", switches: { in_app: false, email: false }, quiet: { start: "21:00", end: "06:30" }, timeZone: "Europe/Lisbon",
      workspaceChannels: ["in_app", "email", "whatsapp", "push"], reach: { in_app: "ok", email: "ok", whatsapp: "destination_missing", push: "ok" } });
    expect(calls.filter((sql) => sql.includes("FROM notification_channel_choices"))).toHaveLength(1);
  });

  it("gives someone not found the defaults: every switch on, no quiet hours, no phone", () => {
    expect(defaultNoticeChoices("u", "site.report_missing")).toMatchObject({ group: "projects", switches: {}, quiet: null, reach: { push: "push_off" } });
  });
});
