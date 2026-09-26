import { describe, expect, it } from "vitest";
import { zonedToUtc, zonedToday } from "./zoned-time";

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
});
