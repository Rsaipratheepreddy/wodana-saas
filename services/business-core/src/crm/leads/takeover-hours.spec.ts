import { describe, expect, it } from "vitest";
import { addSlaMinutes, normalizeSlaSchedule } from "./sla-schedule";

// PLM-039: one working hour, Mon–Sun 09:00–18:00 in the workspace's time zone.
const day = [{ start: "09:00", end: "18:00" }];
const hours = normalizeSlaSchedule({ version: 1, mode: "business", timezone: "Asia/Dubai",
  weeklyHours: { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day }, holidays: [], dateOverrides: {} });
const dubai = (iso: string) => new Date(`${iso}+04:00`);

describe("takeover countdown on working hours", () => {
  it("counts an hour inside the day", () => {
    expect(addSlaMinutes(dubai("2026-09-26T10:15:00"), 60, hours).toISOString()).toBe(dubai("2026-09-26T11:15:00").toISOString());
  });
  it("does not move overnight: 18:05 is reassigned at 10:00 the next day", () => {
    expect(addSlaMinutes(dubai("2026-09-26T18:05:00"), 60, hours).toISOString()).toBe(dubai("2026-09-27T10:00:00").toISOString());
  });
  it("splits across days: 17:30 has 30 minutes today and 30 from 09:00", () => {
    expect(addSlaMinutes(dubai("2026-09-26T17:30:00"), 60, hours).toISOString()).toBe(dubai("2026-09-27T09:30:00").toISOString());
  });
  it("works on weekends too (Mon–Sun)", () => {
    expect(addSlaMinutes(dubai("2026-09-27T08:00:00"), 60, hours).toISOString()).toBe(dubai("2026-09-27T10:00:00").toISOString());
  });
});
