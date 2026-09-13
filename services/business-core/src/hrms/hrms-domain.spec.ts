import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  Calendar,
  csvCell,
  dateRange,
  fingerprint,
  leaveUnits,
  locationEvidence,
  splitInterval,
  zonedInstant,
} from "./hrms-domain";
import { AttendanceActionDto, CalendarDto } from "./hrms.dto";
const calendar: Calendar = {
  name: "Studio",
  timezone: "Asia/Kolkata",
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: ["2026-09-07"],
  dayStart: "09:00",
  halfDay: "13:00",
  dayEnd: "18:00",
};
describe("attendance and leave rules", () => {
  it("counts multiple intervals without dropping later work", () => {
    const total = [
      ["2026-09-08T03:30:00Z", "2026-09-08T06:30:00Z"],
      ["2026-09-08T07:30:00Z", "2026-09-08T11:30:00Z"],
    ]
      .flatMap(([s, e]) => splitInterval(s, e, calendar.timezone))
      .reduce((sum, p) => sum + p.milliseconds / 60000, 0);
    expect(total).toBe(420);
  });
  it("splits overnight work at the work calendar midnight", () => {
    expect(
      splitInterval(
        "2026-09-08T17:30:00Z",
        "2026-09-08T20:30:00Z",
        "Asia/Kolkata",
      ),
    ).toEqual([
      { date: "2026-09-08", milliseconds: 3600000 },
      { date: "2026-09-09", milliseconds: 7200000 },
    ]);
  });
  it("handles a DST day with 23 hours", () => {
    const start = zonedInstant("2026-03-08", "00:00", "America/New_York"),
      end = zonedInstant("2026-03-09", "00:00", "America/New_York");
    expect(splitInterval(start, end, "America/New_York")).toEqual([
      { date: "2026-03-08", milliseconds: 23 * 3600000 },
    ]);
  });
  it("counts Saturday, skips holidays and separates half days", () => {
    expect(
      leaveUnits("2026-09-05", "2026-09-07", "full", calendar),
    ).toHaveLength(2);
    expect(
      leaveUnits("2026-09-08", "2026-09-08", "first_half", calendar)[0].part,
    ).toBe("first_half");
    expect(
      leaveUnits("2026-09-08", "2026-09-08", "second_half", calendar)[0].part,
    ).toBe("second_half");
  });
  it("preserves leave units across year boundaries", () => {
    const units = leaveUnits("2026-12-31", "2027-01-02", "full", calendar);
    expect(units.filter((u) => u.date.startsWith("2026"))).toHaveLength(2);
    expect(units.filter((u) => u.date.startsWith("2027"))).toHaveLength(4);
  });
  it("rejects invalid dates and half-day ranges", () => {
    expect(() => dateRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() =>
      leaveUnits("2026-09-08", "2026-09-09", "first_half", calendar),
    ).toThrow();
  });
  it("marks stale, inaccurate, boundary and mock locations uncertain", () => {
    const now = new Date("2026-09-07T08:00:00Z"),
      site = { latitude: 0, longitude: 0, radiusM: 150 },
      fix = {
        latitude: 0,
        longitude: 0,
        accuracyM: 10,
        capturedAt: now.toISOString(),
      };
    expect(locationEvidence(fix, site, now, 100, 120).status).toBe("inside");
    for (const change of [
      { accuracyM: 200 },
      { capturedAt: "2026-09-07T07:00:00Z" },
      { mock: true },
      { latitude: 0.0013, accuracyM: 30 },
    ])
      expect(
        locationEvidence({ ...fix, ...change }, site, now, 100, 120).status,
      ).toBe("uncertain");
    expect(
      locationEvidence({ ...fix, latitude: 0.1 }, site, now, 100, 120).status,
    ).toBe("outside");
  });
  it("uses stable hashes and protects CSV cells", () => {
    expect(fingerprint({ b: 1, a: { d: 2, c: 3 } })).toBe(
      fingerprint({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(csvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
  });
  it("rejects a supplied employee on a self-service action", () => {
    const input = plainToInstance(AttendanceActionDto, {
      membershipId: "other-user",
      kind: "check_in",
      mode: "office",
    });
    expect(
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true }).some(
        (e) => e.property === "membershipId",
      ),
    ).toBe(true);
  });
  it("rejects duplicate workdays", () => {
    const input = plainToInstance(CalendarDto, {
      name: "Office",
      timezone: "UTC",
      workingDays: [1, 1],
    });
    expect(validateSync(input).some((e) => e.property === "workingDays")).toBe(
      true,
    );
  });
});
