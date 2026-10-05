import { describe, expect, it } from "vitest";
import {
  bookingIcs, changeAllowed, computeSlots, describeSlot, hostWindows, manageToken, parseDateRange, parseQuestions, slugify, tokenHash,
  zonedInstant, type HostAvailability, type SlotRules, type WorkCalendar,
} from "./booking.domain";

const rules = (overrides: Partial<SlotRules> = {}): SlotRules => ({
  durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 0, windowDays: 30, maxPerDay: null, stepMinutes: 60, ...overrides,
});
const host = (overrides: Partial<HostAvailability> = {}): HostAvailability => ({ membershipId: "a", leave: [], overrides: [], busy: [], bookedPerDay: {}, ...overrides });
const london: WorkCalendar = { timeZone: "Europe/London", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", holidays: [] };
const times = (slots: { start: string }[]) => slots.map((slot) => slot.start);
const at = (iso: string) => Date.parse(iso);

describe("booking slots", () => {
  it("offers the working hours on working days in the firm's zone", () => {
    // Monday 2031-03-03 in London (UTC+0 in March before the change).
    const slots = computeSlots({ rules: rules(), calendar: london, hosts: [host()], from: "2031-03-01", to: "2031-03-03", now: new Date("2031-02-28T00:00:00Z") });
    expect(times(slots)).toEqual(["2031-03-03T09:00:00.000Z", "2031-03-03T10:00:00.000Z", "2031-03-03T11:00:00.000Z"]);
    expect(slots[0]).toMatchObject({ date: "2031-03-03", end: "2031-03-03T10:00:00.000Z", hostIds: ["a"] });
  });

  it("follows daylight saving: the same wall time is an hour earlier in UTC after the change", () => {
    // London moves to BST on Sunday 30 March 2031.
    const slots = computeSlots({ rules: rules(), calendar: london, hosts: [host()], from: "2031-03-28", to: "2031-03-31", now: new Date("2031-03-01T00:00:00Z") });
    const firstOfDay = (date: string) => slots.find((slot) => slot.date === date)?.start;
    expect([firstOfDay("2031-03-28"), firstOfDay("2031-03-31")]).toEqual(["2031-03-28T09:00:00.000Z", "2031-03-31T08:00:00.000Z"]);
  });

  it("skips a wall time that does not exist in the spring-forward gap", () => {
    expect(zonedInstant("2031-03-30", 60, "Europe/London", "exact")).toBeNull();
    expect(zonedInstant("2031-03-30", 60, "Europe/London", "compatible")).toBe(at("2031-03-30T01:00:00Z"));
    const calendar = { ...london, workingDays: [0], start: "00:00", end: "04:00" };
    const slots = computeSlots({ rules: rules(), calendar, hosts: [host()], from: "2031-03-30", to: "2031-03-30", now: new Date("2031-03-01T00:00:00Z") });
    // 00:00 GMT, then 02:00 and 03:00 BST: 01:00 never happens that night.
    expect(times(slots)).toEqual(["2031-03-30T00:00:00.000Z", "2031-03-30T01:00:00.000Z", "2031-03-30T02:00:00.000Z"]);
  });

  it("shows the firm's slot to a visitor in another country at the same instant", () => {
    const dubai: WorkCalendar = { timeZone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5], start: "10:00", end: "11:00", holidays: [] };
    const [slot] = computeSlots({ rules: rules(), calendar: dubai, hosts: [host()], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") });
    expect(slot.start).toBe("2031-03-03T06:00:00.000Z");
    expect(describeSlot(slot.start, slot.end, "America/New_York", "en")).toContain("1:00");
  });

  it("keeps the minimum notice and the booking window", () => {
    const now = new Date("2031-03-03T09:30:00Z");
    const slots = computeSlots({ rules: rules({ minimumNoticeMinutes: 60, windowDays: 1 }), calendar: london, hosts: [host()], from: "2031-03-03", to: "2031-03-10", now });
    expect(times(slots)).toEqual(["2031-03-03T11:00:00.000Z", "2031-03-04T09:00:00.000Z", "2031-03-04T10:00:00.000Z", "2031-03-04T11:00:00.000Z"]);
  });

  it("keeps buffers clear of busy time", () => {
    const busy = [{ start: at("2031-03-03T10:00:00Z"), end: at("2031-03-03T10:30:00Z") }];
    const plain = computeSlots({ rules: rules({ stepMinutes: 30 }), calendar: london, hosts: [host({ busy })], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") });
    expect(times(plain)).toEqual(["2031-03-03T09:00:00.000Z", "2031-03-03T10:30:00.000Z", "2031-03-03T11:00:00.000Z"]);
    const buffered = computeSlots({ rules: rules({ stepMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }), calendar: london, hosts: [host({ busy })], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") });
    expect(times(buffered)).toEqual(["2031-03-03T11:00:00.000Z"]);
  });

  it("stops a host at the daily maximum", () => {
    const slots = computeSlots({ rules: rules({ maxPerDay: 2 }), calendar: london, hosts: [host({ bookedPerDay: { "2031-03-03": 2 } })], from: "2031-03-03", to: "2031-03-04", now: new Date("2031-03-01T00:00:00Z") });
    expect(slots.every((slot) => slot.date === "2031-03-04")).toBe(true);
  });

  it("closes a region holiday, but extra hours open it for one person", () => {
    const calendar = { ...london, holidays: ["2031-03-03"] };
    expect(computeSlots({ rules: rules(), calendar, hosts: [host()], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") })).toEqual([]);
    const extra = host({ overrides: [{ startsOn: "2031-03-03", endsOn: "2031-03-03", kind: "extra", startTime: "14:00", endTime: "15:00" }] });
    expect(times(computeSlots({ rules: rules(), calendar, hosts: [extra], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") }))).toEqual(["2031-03-03T14:00:00.000Z"]);
  });

  it("removes leave (whole or half day) and blocked hours", () => {
    const now = new Date("2031-03-01T00:00:00Z");
    const range = { from: "2031-03-03", to: "2031-03-05" };
    const onLeave = host({ leave: [{ start: "2031-03-03", end: "2031-03-03", dayPart: "full" }, { start: "2031-03-04", end: "2031-03-04", dayPart: "first_half" }],
      overrides: [{ startsOn: "2031-03-05", endsOn: "2031-03-05", kind: "blocked", startTime: "10:00", endTime: "11:00" }] });
    expect(times(computeSlots({ rules: rules(), calendar: london, hosts: [onLeave], ...range, now }))).toEqual([
      "2031-03-04T11:00:00.000Z", "2031-03-05T09:00:00.000Z", "2031-03-05T11:00:00.000Z",
    ]);
    const blockedDay = host({ overrides: [{ startsOn: "2031-03-03", endsOn: "2031-03-05", kind: "blocked", startTime: null, endTime: null }] });
    expect(computeSlots({ rules: rules(), calendar: london, hosts: [blockedDay], ...range, now })).toEqual([]);
  });

  it("allows a slot that runs past midnight in the firm's zone when the hours continue", () => {
    const late = host({ overrides: [
      { startsOn: "2031-03-03", endsOn: "2031-03-03", kind: "extra", startTime: "23:00", endTime: "24:00" },
      { startsOn: "2031-03-04", endsOn: "2031-03-04", kind: "extra", startTime: "00:00", endTime: "01:00" },
    ] });
    const calendar = { ...london, workingDays: [] };
    const slots = computeSlots({ rules: rules({ stepMinutes: 30 }), calendar, hosts: [late], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") });
    expect(times(slots)).toEqual(["2031-03-03T23:00:00.000Z", "2031-03-03T23:30:00.000Z"]);
    expect(slots[1].end).toBe("2031-03-04T00:30:00.000Z");
  });

  it("lists every free host of a round-robin team", () => {
    const busy = [{ start: at("2031-03-03T09:00:00Z"), end: at("2031-03-03T10:00:00Z") }];
    const slots = computeSlots({ rules: rules(), calendar: london, hosts: [host({ membershipId: "a", busy }), host({ membershipId: "b" })], from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z") });
    expect(slots.map((slot) => slot.hostIds)).toEqual([["b"], ["a", "b"], ["a", "b"]]);
  });

  it("gives working windows per date", () => {
    expect(hostWindows("2031-03-01", london, host())).toEqual([]);
    expect(hostWindows("2031-03-03", london, host())).toEqual([{ start: at("2031-03-03T09:00:00Z"), end: at("2031-03-03T12:00:00Z") }]);
  });
});

describe("booking rules", () => {
  it("refuses a change inside the cancellation notice", () => {
    const now = new Date("2031-03-03T08:00:00Z");
    expect(changeAllowed({ status: "confirmed", startsAt: "2031-03-03T09:00:00Z" }, 120, now)).toMatchObject({ allowed: false });
    expect(changeAllowed({ status: "confirmed", startsAt: "2031-03-03T11:00:00Z" }, 120, now)).toEqual({ allowed: true });
    expect(changeAllowed({ status: "cancelled", startsAt: "2031-03-09T11:00:00Z" }, 0, now)).toMatchObject({ allowed: false });
  });

  it("signs manage links: the same booking gives the same token, a different nonce does not", () => {
    const token = manageToken("s".repeat(32), "w", "b", "n1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manageToken("s".repeat(32), "w", "b", "n1")).toBe(token);
    expect(manageToken("s".repeat(32), "w", "b", "n2")).not.toBe(token);
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses questions and ranges", () => {
    expect(parseQuestions([{ field: "emirate", required: true }, "summary"])).toEqual([{ field: "emirate", required: true }, { field: "summary", required: false }]);
    expect(() => parseQuestions([{ field: "password" }])).toThrow();
    expect(() => parseQuestions(["summary", "summary"])).toThrow();
    expect(parseDateRange("2031-03-01", "2031-03-31")).toEqual({ from: "2031-03-01", to: "2031-03-31" });
    expect(parseDateRange("2031-03-31", "2031-03-01")).toBeNull();
    expect(parseDateRange("2031-01-01", "2031-06-01")).toBeNull();
    expect(slugify(" Design consultation! ")).toBe("design-consultation");
  });

  it("writes a valid calendar invitation and its cancellation", () => {
    const ics = bookingIcs({ uid: "b@wodana", sequence: 2, method: "REQUEST", start: "2031-03-03T09:00:00Z", end: "2031-03-03T10:00:00Z",
      summary: "Design consultation, Studio", location: "Villa 4; Palm", organizer: { name: "Studio" }, attendee: { name: "Maya", email: "maya@example.com" }, now: new Date("2031-03-01T00:00:00Z") });
    expect(ics).toContain("DTSTART:20310303T090000Z\r\n");
    expect(ics).toContain("SUMMARY:Design consultation\\, Studio\r\n");
    expect(ics).toContain("LOCATION:Villa 4\\; Palm\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(bookingIcs({ uid: "b", sequence: 3, method: "CANCEL", start: "2031-03-03T09:00:00Z", end: "2031-03-03T10:00:00Z", summary: "x", organizer: { name: "S" } })).toContain("STATUS:CANCELLED");
  });
});
