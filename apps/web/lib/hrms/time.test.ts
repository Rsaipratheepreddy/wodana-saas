import { describe, expect, it } from "vitest";
import { addDays, addMonths, clock, parseMinutes } from "./time";

describe("timesheet hours", () => {
  it("reads hours the ways people type them, and nothing else", () => {
    expect(parseMinutes("7:30")).toBe(450);
    expect(parseMinutes("7.5")).toBe(450);
    expect(parseMinutes("7,25")).toBe(435);
    expect(parseMinutes("8")).toBe(480);
    expect(parseMinutes("7h 30m")).toBe(450);
    expect(parseMinutes("45m")).toBe(45);
    expect(parseMinutes(" ")).toBe(0);
    for (const text of ["7:75", "abc", "-2", "25:00", "1:2"]) expect(parseMinutes(text), text).toBeNull();
  });

  it("writes hours as a timesheet cell shows them", () => {
    expect(clock(450)).toBe("7:30");
    expect(clock(65)).toBe("1:05");
    expect(clock(0)).toBe("");
  });

  it("steps calendar days and months across their ends", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});
