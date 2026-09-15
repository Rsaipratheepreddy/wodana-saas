import { describe, expect, it } from "vitest";
import {
  addSlaMinutes,
  calculateSlaDeadlines,
  normalizeSlaSchedule,
  remainingSlaMinutes,
  SlaScheduleValidationError,
} from "./sla-schedule";

const dubaiWeek = () => normalizeSlaSchedule({
  version: 1,
  mode: "business",
  timezone: "Asia/Dubai",
  weeklyHours: {
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
  },
  holidays: [],
  dateOverrides: {},
});

describe("normalizeSlaSchedule", () => {
  it("keeps existing policies backward compatible with elapsed time", () => {
    expect(normalizeSlaSchedule({})).toEqual({ version: 1, mode: "elapsed" });
    expect(normalizeSlaSchedule(undefined, "elapsed")).toEqual({ version: 1, mode: "elapsed" });
  });

  it("canonicalizes business calendars without mutating the input", () => {
    const input = {
      timezone: "Asia/Dubai",
      weeklyHours: {
        monday: [
          { start: "13:00", end: "17:00" },
          { start: "09:00", end: "12:00" },
        ],
      },
      holidays: ["2026-12-02", "2026-12-02"],
      dateOverrides: { "2026-12-03": [] },
    };
    expect(normalizeSlaSchedule(input, "business")).toEqual({
      version: 1,
      mode: "business",
      timezone: "Asia/Dubai",
      weeklyHours: {
        monday: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      },
      holidays: ["2026-12-02"],
      dateOverrides: { "2026-12-03": [] },
    });
    expect(input.weeklyHours.monday[0].start).toBe("13:00");
  });

  it.each([
    [{ mode: "business", timezone: "Not/AZone", weeklyHours: { monday: [{ start: "09:00", end: "17:00" }] } }, "timezone"],
    [{ mode: "business", timezone: "UTC", weeklyHours: {} }, "recurring"],
    [{ mode: "business", timezone: "UTC", weeklyHours: { monday: [{ start: "09:60", end: "17:00" }] } }, "HH:mm"],
    [{ mode: "business", timezone: "UTC", weeklyHours: { monday: [{ start: "09:00", end: "09:00" }] } }, "different"],
    [{ mode: "business", timezone: "UTC", weeklyHours: { monday: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] } }, "overlapping"],
    [{ mode: "business", timezone: "UTC", weeklyHours: { monday: [{ start: "22:00", end: "06:00" }], tuesday: [{ start: "05:00", end: "08:00" }] } }, "across days"],
    [{ mode: "business", timezone: "UTC", weeklyHours: { monday: [{ start: "09:00", end: "17:00" }] }, holidays: ["2026-02-30"] }, "calendar date"],
    [{ version: 2, mode: "elapsed" }, "version"],
    [{ mode: "elapsed", timezone: "UTC" }, "unsupported"],
  ])("rejects an unsafe schedule (%s)", (value, message) => {
    expect(() => normalizeSlaSchedule(value)).toThrowError(new RegExp(String(message), "i"));
  });

  it("rejects a mode mismatch between the policy and schedule", () => {
    expect(() => normalizeSlaSchedule({ mode: "elapsed" }, "business"))
      .toThrowError(/must match/i);
  });
});

describe("SLA deadline calculation", () => {
  it("preserves elapsed-minute behaviour", () => {
    const schedule = normalizeSlaSchedule({});
    const result = calculateSlaDeadlines(new Date("2026-09-18T12:30:00.000Z"), 30, 120, schedule);
    expect(result.warningAt.toISOString()).toBe("2026-09-18T13:00:00.000Z");
    expect(result.dueAt.toISOString()).toBe("2026-09-18T14:30:00.000Z");
  });

  it("carries business minutes across a weekend", () => {
    expect(addSlaMinutes(new Date("2026-09-18T12:30:00.000Z"), 120, dubaiWeek()).toISOString())
      .toBe("2026-09-21T06:30:00.000Z");
  });

  it("starts at the next opening when intake arrives after hours", () => {
    expect(addSlaMinutes(new Date("2026-09-18T16:00:00.000Z"), 60, dubaiWeek()).toISOString())
      .toBe("2026-09-21T06:00:00.000Z");
  });

  it("skips holidays and lets a date override reopen a holiday", () => {
    const closedMonday = normalizeSlaSchedule({
      ...dubaiWeek(),
      holidays: ["2026-09-21"],
    });
    expect(addSlaMinutes(new Date("2026-09-18T12:30:00.000Z"), 120, closedMonday).toISOString())
      .toBe("2026-09-22T06:30:00.000Z");

    const reopenedMonday = normalizeSlaSchedule({
      ...closedMonday,
      dateOverrides: { "2026-09-21": [{ start: "10:00", end: "12:00" }] },
    });
    expect(addSlaMinutes(new Date("2026-09-18T12:30:00.000Z"), 120, reopenedMonday).toISOString())
      .toBe("2026-09-21T07:30:00.000Z");
  });

  it("does not count a split-shift break", () => {
    const splitShift = normalizeSlaSchedule({
      mode: "business",
      timezone: "Asia/Dubai",
      weeklyHours: { monday: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] },
    });
    expect(addSlaMinutes(new Date("2026-09-21T07:30:00.000Z"), 120, splitShift).toISOString())
      .toBe("2026-09-21T10:30:00.000Z");
  });

  it("continues an overnight shift after midnight", () => {
    const overnight = normalizeSlaSchedule({
      mode: "business",
      timezone: "Asia/Dubai",
      weeklyHours: { monday: [{ start: "22:00", end: "06:00" }] },
    });
    expect(addSlaMinutes(new Date("2026-09-21T21:00:00.000Z"), 120, overnight).toISOString())
      .toBe("2026-09-21T23:00:00.000Z");
  });

  it("uses real elapsed time through the daylight-saving spring gap", () => {
    const newYorkSunday = normalizeSlaSchedule({
      mode: "business",
      timezone: "America/New_York",
      weeklyHours: { sunday: [{ start: "01:00", end: "04:00" }] },
    });
    expect(addSlaMinutes(new Date("2026-03-08T06:30:00.000Z"), 90, newYorkSunday).toISOString())
      .toBe("2026-03-08T08:00:00.000Z");
  });

  it("uses the full repeated hour during the daylight-saving fall overlap", () => {
    const newYorkSunday = normalizeSlaSchedule({
      mode: "business",
      timezone: "America/New_York",
      weeklyHours: { sunday: [{ start: "00:00", end: "03:00" }] },
    });
    expect(addSlaMinutes(new Date("2026-11-01T04:30:00.000Z"), 180, newYorkSunday).toISOString())
      .toBe("2026-11-01T07:30:00.000Z");
  });

  it("keeps a zero-minute warning at the exact received instant", () => {
    const startedAt = new Date("2026-09-21T05:00:37.500Z");
    expect(addSlaMinutes(startedAt, 0, dubaiWeek()).toISOString()).toBe(startedAt.toISOString());
  });

  it("calculates remaining business time without counting closed periods", () => {
    expect(remainingSlaMinutes(
      new Date("2026-09-18T12:30:00.000Z"),
      new Date("2026-09-21T06:30:00.000Z"),
      dubaiWeek(),
    )).toBe(120);
  });

  it("rounds a partial remaining minute up so a pause cannot shorten the SLA", () => {
    expect(remainingSlaMinutes(
      new Date("2026-09-21T05:00:30.000Z"),
      new Date("2026-09-21T05:02:00.000Z"),
      dubaiWeek(),
    )).toBe(2);
  });

  it("rejects invalid deadline inputs", () => {
    expect(() => calculateSlaDeadlines(new Date("invalid"), 10, 20, dubaiWeek()))
      .toThrow(SlaScheduleValidationError);
    expect(() => calculateSlaDeadlines(new Date(), 20, 20, dubaiWeek()))
      .toThrow(/later than warning/i);
  });
});
