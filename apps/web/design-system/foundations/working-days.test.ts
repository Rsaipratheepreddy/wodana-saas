import { describe, expect, it } from "vitest";
import { nextWorkingHalfHour, workingCalendar } from "./working-days";

// Monday to Friday, 09:00–18:00 (30 Sep 2026 is a Wednesday).
const week = workingCalendar([1, 2, 3, 4, 5]);
const hours = { start: "09:00", end: "18:00" };
const wall = (text: string) => new Date(text);
const text = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

describe("nextWorkingHalfHour", () => {
  it("is the next half-hour while the working day is open", () => {
    expect(text(nextWorkingHalfHour(wall("2026-09-30T10:07:00"), week, hours))).toBe("2026-09-30 10:30");
  });
  it("waits for the day to open, and moves past the evening and the weekend to the next working morning", () => {
    expect(text(nextWorkingHalfHour(wall("2026-09-30T00:10:00"), week, hours))).toBe("2026-09-30 09:00");
    expect(text(nextWorkingHalfHour(wall("2026-10-02T17:45:00"), week, hours))).toBe("2026-10-05 09:00");
  });
  it("keeps the next half-hour when the working hours aren't known", () => {
    expect(text(nextWorkingHalfHour(wall("2026-09-30T00:10:00"), week, null))).toBe("2026-09-30 00:30");
  });
});
