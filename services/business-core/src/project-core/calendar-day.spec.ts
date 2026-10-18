import { describe, expect, it } from "vitest";
import { calendarDay } from "./calendar-day";

describe("a calendar day from a request", () => {
  it("keeps a real day as given and reads nothing as null", () => {
    expect(calendarDay("2026-11-10", "Start date")).toBe("2026-11-10");
    expect(calendarDay("1900-01-01", "Start date")).toBe("1900-01-01");
    expect(calendarDay("2199-12-31", "Due date")).toBe("2199-12-31");
    expect(calendarDay(undefined, "Start date")).toBeNull();
    expect(calendarDay(null, "Start date")).toBeNull();
    expect(calendarDay("", "Start date")).toBeNull();
  });

  it("refuses what isn't a day", () => {
    expect(() => calendarDay("10/11/2026", "Start date")).toThrow("Start date must be a date.");
    expect(() => calendarDay("2026-11-10T00:00:00Z", "Start date")).toThrow("Start date must be a date.");
    expect(() => calendarDay(20261110, "Start date")).toThrow("Start date must be a date.");
  });

  it("refuses a year still being typed, so no plan is scheduled in year 202", () => {
    expect(() => calendarDay("0202-11-10", "Start date")).toThrow("Start date needs a full year (1900 to 2199).");
    expect(() => calendarDay("0026-11-10", "Due date")).toThrow("Due date needs a full year (1900 to 2199).");
    expect(() => calendarDay("2260-01-01", "Due date")).toThrow("Due date needs a full year (1900 to 2199).");
  });
});
