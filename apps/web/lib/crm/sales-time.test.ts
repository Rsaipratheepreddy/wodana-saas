import { describe, expect, it } from "vitest";
import { deadlineText, durationParts, nextWorkingMoment, quickFollowUps, respondBy, salesHours, wallClock } from "./sales-time";

const policy = {
  eventType: "first_response", status: "active", calculationMode: "business",
  schedule: { mode: "business", timezone: "Asia/Dubai", holidays: ["2026-10-05"], dateOverrides: {},
    weeklyHours: Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => [day, [{ start: "09:00", end: "18:00" }]])) },
};

describe("sales time", () => {
  it("reads the running response timer: on track, at warning, overdue", () => {
    const now = Date.parse("2026-10-03T06:00:00Z");
    expect(respondBy({ slaStatus: "active", slaDueAt: "2026-10-03T06:42:00Z", slaWarningAt: "2026-10-03T06:30:00Z" }, now)).toEqual({ dueAt: "2026-10-03T06:42:00Z", state: "on_track", minutesLeft: 42 });
    expect(respondBy({ slaStatus: "active", slaDueAt: "2026-10-03T06:10:00Z", slaWarningAt: "2026-10-03T05:50:00Z" }, now)?.state).toBe("warning");
    expect(respondBy({ slaStatus: "breached", slaDueAt: "2026-10-03T05:00:00Z" }, now)).toMatchObject({ state: "breached", minutesLeft: -60 });
    expect(respondBy({ slaStatus: "met", slaDueAt: "2026-10-03T07:00:00Z" }, now)).toBeNull();
    expect(respondBy({ slaStatus: null, slaDueAt: null }, now)).toBeNull();
  });

  it("says durations and deadlines the way a salesperson reads them", () => {
    expect(durationParts(42)).toEqual({ unit: "min", minutes: 42 });
    expect(durationParts(-185)).toEqual({ unit: "h", hours: 3, minutes: 5 });
    expect(durationParts(3000)).toEqual({ unit: "d", days: 2 });
    const friday = new Date("2026-10-02T15:00:00Z");
    expect(deadlineText("2026-10-03T06:00:00Z", { locale: "en", timeZone: "Asia/Dubai" }, friday)).toBe("Sat 10:00");
    expect(deadlineText("2026-10-02T16:00:00Z", { locale: "en", timeZone: "Asia/Dubai" }, friday)).toBe("20:00");
  });

  it("suggests the next try inside Sales working hours (S-16)", () => {
    const hours = salesHours([policy], "UTC");
    const evening = new Date("2026-10-04T13:30:00Z"); // Sun 17:30 in Dubai
    const [twoHours, nextDay, threeDays] = quickFollowUps(hours, evening);
    expect(twoHours.at.toISOString()).toBe("2026-10-06T05:00:00.000Z"); // Mon is a holiday, so Tue 09:00
    expect(nextDay.at.toISOString()).toBe("2026-10-06T05:00:00.000Z");
    expect(threeDays.at.toISOString()).toBe("2026-10-07T05:00:00.000Z");
    expect(nextWorkingMoment(hours, new Date("2026-10-03T07:00:00Z")).toISOString()).toBe("2026-10-03T07:00:00.000Z");
    expect(wallClock(threeDays.at, "Asia/Dubai")).toBe("2026-10-07T09:00");
  });

  it("uses the workspace zone and a 09:00 suggestion when Sales runs around the clock", () => {
    const hours = salesHours([], "Asia/Kolkata");
    const [twoHours, nextDay] = quickFollowUps(hours, new Date("2026-10-03T15:00:00Z"));
    expect(twoHours.at.toISOString()).toBe("2026-10-03T17:00:00.000Z");
    expect(wallClock(nextDay.at, "Asia/Kolkata")).toBe("2026-10-04T09:00");
  });
});
