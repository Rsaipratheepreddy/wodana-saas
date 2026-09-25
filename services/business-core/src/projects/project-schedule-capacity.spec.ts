import { describe, expect, it } from "vitest";
import { bookingSlots, validateCalendar } from "./project-calendar";
import {
  capacityConfiguration,
  exceedsPooledCapacity,
  resourceAvailability,
  scheduleStatus,
} from "./project-schedule-capacity";

describe("project schedule capacity", () => {
  it("keeps people exclusive while allowing configured pooled capacity", () => {
    expect(capacityConfiguration("crew", "exclusive", 1)).toEqual({ capacityMode: "exclusive", capacity: 1 });
    expect(capacityConfiguration("factory", "pooled", 4)).toEqual({ capacityMode: "pooled", capacity: 4 });
    expect(() => capacityConfiguration("person", "pooled", 2)).toThrow(/exclusive/);
    expect(() => capacityConfiguration("vendor", "exclusive", 2)).toThrow(/capacity of one/);
  });

  it("supports overnight shifts without changing the shift start date", () => {
    const calendar = validateCalendar({
      weekdays: [1],
      startTime: "20:00",
      endTime: "06:00",
      holidays: [],
    });
    expect(bookingSlots("2026-09-07", "2026-09-07", calendar, "22:00", "02:00")).toEqual([
      { date: "2026-09-07", endDate: "2026-09-08", startTime: "22:00", endTime: "02:00" },
    ]);
    expect(() => bookingSlots("2026-09-07", "2026-09-07", calendar, "19:00", "02:00")).toThrow(/within/);
    const [availability] = resourceAvailability(
      [{ id: "night", capacityMode: "exclusive", capacity: 1, calendar }],
      [],
      "2026-09-08",
      "2026-09-08",
    );
    expect(availability.segments[0]).toMatchObject({
      date: "2026-09-07",
      endDate: "2026-09-08",
      startTime: "20:00",
      endTime: "06:00",
    });
  });

  it("returns confirmed use, tentative demand and true available gaps", () => {
    const calendar = validateCalendar({ weekdays: [1], startTime: "08:00", endTime: "12:00", holidays: [] });
    const [availability] = resourceAvailability(
      [{ id: "factory", capacityMode: "pooled", capacity: 3, calendar }],
      [
        { bookingId: "confirmed", resourceId: "factory", status: "confirmed", units: 2, date: "2026-09-07", startTime: "08:00", endTime: "10:00" },
        { bookingId: "tentative", resourceId: "factory", status: "tentative", units: 1, date: "2026-09-07", startTime: "09:00", endTime: "11:00" },
      ],
      "2026-09-07",
      "2026-09-07",
    );
    expect(availability.segments).toEqual([
      expect.objectContaining({ startTime: "08:00", endTime: "09:00", confirmed: 2, tentative: 0, remaining: 1 }),
      expect.objectContaining({ startTime: "09:00", endTime: "10:00", confirmed: 2, tentative: 1, remaining: 1 }),
      expect.objectContaining({ startTime: "10:00", endTime: "11:00", confirmed: 0, tentative: 1, remaining: 3 }),
      expect.objectContaining({ startTime: "11:00", endTime: "12:00", confirmed: 0, tentative: 0, remaining: 3 }),
    ]);
    expect(availability.gapCount).toBe(4);
    expect(availability.gapMinutes).toBe(240);
    expect(availability.availableCapacityMinutes).toBe(480);
  });

  it("dates split overnight availability on the actual calendar day", () => {
    const calendar = validateCalendar({ weekdays: [1], startTime: "20:00", endTime: "06:00", holidays: [] });
    const [availability] = resourceAvailability(
      [{ id: "night", capacity: 2, calendar }],
      [{ bookingId: "after-midnight", resourceId: "night", status: "confirmed", units: 1,
        date: "2026-09-08", startTime: "00:00", endTime: "02:00" }],
      "2026-09-07", "2026-09-07",
    );
    expect(availability.segments).toEqual([
      expect.objectContaining({ date: "2026-09-07", endDate: "2026-09-08", startTime: "20:00", endTime: "00:00", durationMinutes: 240, confirmed: 0 }),
      expect.objectContaining({ date: "2026-09-08", startTime: "00:00", endTime: "02:00", durationMinutes: 120, confirmed: 1 }),
      expect.objectContaining({ date: "2026-09-08", startTime: "02:00", endTime: "06:00", durationMinutes: 240, confirmed: 0 }),
    ]);
    expect(availability.segments[1]).not.toHaveProperty("endDate");
    expect(availability.segments[2]).not.toHaveProperty("endDate");
    expect(availability.availableCapacityMinutes).toBe(1080);
  });

  it("validates every lifecycle state", () => {
    expect(scheduleStatus("draft")).toBe("draft");
    expect(scheduleStatus("completed")).toBe("completed");
    expect(() => scheduleStatus("deleted")).toThrow(/valid booking status/);
  });

  it("checks pooled usage at the same instant instead of summing separate jobs", () => {
    const request = [{ date: "2026-09-07", startTime: "08:00", endTime: "12:00" }];
    const separate = [
      { units: 2, slots: [{ date: "2026-09-07", startTime: "08:00", endTime: "09:00" }] },
      { units: 2, slots: [{ date: "2026-09-07", startTime: "10:00", endTime: "11:00" }] },
    ];
    expect(exceedsPooledCapacity(request, 2, separate, 4)).toBe(false);
    expect(exceedsPooledCapacity(request, 3, separate, 4)).toBe(true);
  });
});
