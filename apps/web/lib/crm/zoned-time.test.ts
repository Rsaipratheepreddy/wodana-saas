import { describe, expect, it } from "vitest";
import { atWallClock, fromWallClock, zonedDateTime, zonedDateTimeToIso, zonedToUtc, zonedToday } from "./zoned-time";

describe("zoned time", () => {
  it("turns a wall-clock time in a zone into UTC, across daylight saving", () => {
    expect(zonedToUtc("2031-01-15", "09:00", "Europe/London")).toBe("2031-01-15T09:00:00.000Z");
    expect(zonedToUtc("2031-07-15", "09:00", "Europe/London")).toBe("2031-07-15T08:00:00.000Z");
    expect(zonedToUtc("2031-07-15", "09:30", "Asia/Kolkata")).toBe("2031-07-15T04:00:00.000Z");
    expect(zonedToUtc("2031-07-15", "09:00", "America/New_York")).toBe("2031-07-15T13:00:00.000Z");
    expect(zonedToUtc("", "09:00", "UTC")).toBeNull();
  });
  it("knows today's date in a zone", () => {
    expect(zonedToday("Pacific/Auckland", new Date("2031-07-15T20:00:00Z"))).toBe("2031-07-16");
  });
  it("reads an instant on the zone's wall clock and back (CAL-2)", () => {
    const wall = atWallClock("2031-07-15T20:30:00Z", "Asia/Dubai");
    expect([wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([2031, 6, 16, 0, 30]);
    expect(fromWallClock(wall, "Asia/Dubai").toISOString()).toBe("2031-07-15T20:30:00.000Z");
    expect(fromWallClock(new Date(2031, 0, 15, 9, 0), "Europe/London").toISOString()).toBe("2031-01-15T09:00:00.000Z");
  });
  it("shows and reads a date-and-time field in the zone", () => {
    expect(zonedDateTime("2031-07-15T04:00:00.000Z", "Asia/Kolkata")).toBe("2031-07-15T09:30");
    expect(zonedDateTimeToIso("2031-07-15T09:30", "Asia/Kolkata")).toBe("2031-07-15T04:00:00.000Z");
    expect(zonedDateTimeToIso("2031-03-09T02:30", "America/New_York")).toBeNull();
    expect(zonedDateTimeToIso("", "UTC")).toBeNull();
  });
});
