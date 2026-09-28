import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { awayDue, decideAutoReply, greetingDue, HUMAN_QUIET_MINUTES, renderAutoReply, unknownAutoReplyFields, withinBusinessHours, zonedParts, type AutoReplyFacts, type AutoReplyRule, type BusinessHours } from "./auto-reply-rules";
import { DEFAULT_QUICK_REPLIES } from "./default-quick-replies";

const HOUR = 3_600_000, DAY = 86_400_000;
// A Sunday-to-Thursday week and a Monday-to-Friday week, as two region packs would give them.
const gulfWeek: BusinessHours = { timeZone: "Asia/Dubai", workingDays: [0, 1, 2, 3, 4], start: "09:00", end: "18:00" };
const londonWeek: BusinessHours = { timeZone: "Europe/London", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:30" };

describe("business hours in the workspace's time zone", () => {
  it("reads the wall clock of the workspace, not the server", () => {
    // 2026-09-27 is a Sunday. 05:30 UTC is 09:30 in Dubai (UTC+4) and 06:30 in London (BST, UTC+1).
    const at = new Date("2026-09-27T05:30:00Z");
    expect(zonedParts(at, "Asia/Dubai")).toEqual({ date: "2026-09-27", weekday: 0, minutes: 9 * 60 + 30 });
    expect(withinBusinessHours(at, gulfWeek)).toBe(true);
    expect(withinBusinessHours(at, londonWeek)).toBe(false);
  });

  it("closes on days off, before opening and at the closing minute", () => {
    expect(withinBusinessHours(new Date("2026-10-02T08:00:00Z"), gulfWeek)).toBe(false); // Friday noon in Dubai
    expect(withinBusinessHours(new Date("2026-10-02T12:00:00Z"), londonWeek)).toBe(true); // Friday 13:00 in London
    expect(withinBusinessHours(new Date("2026-09-28T04:59:00Z"), gulfWeek)).toBe(false); // 08:59
    expect(withinBusinessHours(new Date("2026-09-28T05:00:00Z"), gulfWeek)).toBe(true); // 09:00
    expect(withinBusinessHours(new Date("2026-09-28T14:00:00Z"), gulfWeek)).toBe(false); // 18:00 is closed
  });

  it("follows daylight saving: 08:30 UTC is 09:30 in London in summer and 08:30 in winter", () => {
    expect(withinBusinessHours(new Date("2026-07-01T08:30:00Z"), londonWeek)).toBe(true);
    expect(withinBusinessHours(new Date("2026-12-01T08:30:00Z"), londonWeek)).toBe(false);
  });

  it("treats a holiday as closed", () => {
    expect(withinBusinessHours(new Date("2026-09-28T07:00:00Z"), { ...gulfWeek, holidays: ["2026-09-28"] })).toBe(false);
  });

  it("keeps a night shift on the day it started", () => {
    const night: BusinessHours = { timeZone: "UTC", workingDays: [1], start: "22:00", end: "06:00" };
    expect(withinBusinessHours(new Date("2026-09-28T23:00:00Z"), night)).toBe(true); // Monday 23:00
    expect(withinBusinessHours(new Date("2026-09-29T05:00:00Z"), night)).toBe(true); // Tuesday 05:00, Monday's shift
    expect(withinBusinessHours(new Date("2026-09-29T23:00:00Z"), night)).toBe(false); // Tuesday is not worked
    expect(withinBusinessHours(new Date("2026-09-28T05:00:00Z"), night)).toBe(false); // Monday 05:00 is Sunday's shift
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(withinBusinessHours(new Date("2026-09-28T10:00:00Z"), { ...londonWeek, timeZone: "Mars/Olympus" })).toBe(true);
  });
});

describe("when the greeting and the away message are due", () => {
  const now = new Date("2026-09-28T20:00:00Z");
  it("greets a first message and the first after a quiet spell", () => {
    expect(greetingDue(null, now, 14)).toBe(true);
    expect(greetingDue(new Date(now.getTime() - 13 * DAY), now, 14)).toBe(false);
    expect(greetingDue(new Date(now.getTime() - 14 * DAY), now, 14)).toBe(true);
  });

  it("sends the away message once per chat in each window", () => {
    expect(awayDue(now, gulfWeek, null, 12)).toBe(true);
    expect(awayDue(now, gulfWeek, new Date(now.getTime() - 11 * HOUR), 12)).toBe(false);
    expect(awayDue(now, gulfWeek, new Date(now.getTime() - 12 * HOUR), 12)).toBe(true);
    expect(awayDue(new Date("2026-09-28T07:00:00Z"), gulfWeek, null, 12)).toBe(false); // open
  });
});

describe("which auto reply a client's message gets", () => {
  const rule: AutoReplyRule = {
    greeting: { enabled: true, text: "Hello", silenceDays: 14 },
    away: { enabled: true, text: "Away", windowHours: 12 },
    hours: gulfWeek,
  };
  const open = new Date("2026-09-28T07:00:00Z"), closed = new Date("2026-09-28T20:00:00Z");
  const facts = (change: Partial<AutoReplyFacts> = {}): AutoReplyFacts => ({
    now: open, channel: "whatsapp", direction: "inbound", blocked: false, spam: false, alreadyAnswered: false,
    previousActivityAt: null, lastHumanReplyAt: null, lastAwayAt: null, messageType: "text", ...change,
  });

  it("greets a first contact during hours and sends the away message after hours", () => {
    expect(decideAutoReply(rule, facts())).toEqual({ send: true, kind: "greeting" });
    expect(decideAutoReply(rule, facts({ now: closed }))).toEqual({ send: true, kind: "away" });
    expect(decideAutoReply(rule, facts({ now: closed, lastAwayAt: new Date(closed.getTime() - HOUR) }))).toEqual({ send: true, kind: "greeting" });
    expect(decideAutoReply(rule, facts({ previousActivityAt: new Date(open.getTime() - DAY) }))).toEqual({ send: false, reason: "nothing_due" });
  });

  it("never answers notes, other channels, blocked or spam numbers, reactions or an answered message", () => {
    expect(decideAutoReply(rule, facts({ direction: "internal" }))).toEqual({ send: false, reason: "not_inbound" });
    expect(decideAutoReply(rule, facts({ channel: "email" }))).toEqual({ send: false, reason: "channel" });
    expect(decideAutoReply(rule, facts({ blocked: true }))).toEqual({ send: false, reason: "blocked" });
    expect(decideAutoReply(rule, facts({ spam: true }))).toEqual({ send: false, reason: "blocked" });
    expect(decideAutoReply(rule, facts({ messageType: "reaction" }))).toEqual({ send: false, reason: "not_a_message" });
    expect(decideAutoReply(rule, facts({ alreadyAnswered: true }))).toEqual({ send: false, reason: "duplicate" });
  });

  it("stays quiet while a teammate is talking to the client", () => {
    const recent = new Date(open.getTime() - (HUMAN_QUIET_MINUTES - 1) * 60_000);
    expect(decideAutoReply(rule, facts({ lastHumanReplyAt: recent }))).toEqual({ send: false, reason: "human_active" });
    const earlier = new Date(open.getTime() - (HUMAN_QUIET_MINUTES + 1) * 60_000);
    expect(decideAutoReply(rule, facts({ lastHumanReplyAt: earlier, previousActivityAt: earlier }))).toEqual({ send: false, reason: "nothing_due" });
  });

  it("does nothing when a message is off or empty", () => {
    const off: AutoReplyRule = { ...rule, greeting: { ...rule.greeting, enabled: false }, away: { ...rule.away, text: "  " } };
    expect(decideAutoReply(off, facts())).toEqual({ send: false, reason: "nothing_due" });
    expect(decideAutoReply(off, facts({ now: closed }))).toEqual({ send: false, reason: "nothing_due" });
  });
});

describe("the message the client reads", () => {
  it("fills the fields and closes up a missing one", () => {
    const text = "Hi {{contact.first_name}}, thanks for contacting {{business.name}}.";
    expect(renderAutoReply(text, { "contact.first_name": "Noura", "business.name": "Studio One" })).toBe("Hi Noura, thanks for contacting Studio One.");
    expect(renderAutoReply(text, { "contact.first_name": null, "business.name": "Studio One" })).toBe("Hi, thanks for contacting Studio One.");
    expect(renderAutoReply("{{unknown.field}} Hello", {})).toBe("Hello");
  });

  it("names the fields it can't fill", () => {
    expect(unknownAutoReplyFields("Hi {{contact.first_name}} about {{invoice.total}} and {{invoice.total}}")).toEqual(["invoice.total"]);
  });
});

describe("default quick replies", () => {
  it("match the migration that seeded existing workspaces and name no tenant, currency or country", () => {
    const sql = readFileSync(join(__dirname, "../../../../drizzle/0157_default_quick_replies.sql"), "utf8");
    for (const reply of DEFAULT_QUICK_REPLIES) expect(sql).toContain(`('${reply.shortcut}', '${reply.body}')`);
    expect(DEFAULT_QUICK_REPLIES.map((reply) => reply.shortcut)).toEqual(["thanks", "floorplan", "sitevisit", "quotation", "payment", "handover"]);
    expect(JSON.stringify(DEFAULT_QUICK_REPLIES)).not.toMatch(/AED|INR|USD|Dubai|Emirate|\+971|Palm/i);
  });
});
