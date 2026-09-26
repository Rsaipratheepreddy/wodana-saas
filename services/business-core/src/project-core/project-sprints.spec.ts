import { describe, expect, it } from "vitest";
import { burndown } from "./project-sprints";

describe("sprint burndown", () => {
  const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };

  it("counts committed work left each day against a straight line over working days, flat on days off", () => {
    const days = burndown({ startDate: "2026-10-01", endDate: "2026-10-07", today: "2026-10-05", calendar,
      committed: [{ doneOn: "2026-10-01" }, { doneOn: "2026-10-05" }, { doneOn: null }, { doneOn: "2026-10-09" }, { doneOn: null }] });
    // Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7: five working days.
    expect(days.map((day) => [day.date.slice(8), day.remaining, day.ideal])).toEqual([
      ["01", 4, 4], ["02", 4, 3], ["03", 4, 3], ["04", 4, 3], ["05", 3, 2], ["06", null, 1], ["07", null, 0],
    ]);
  });

  it("has nothing to burn with nothing committed", () => {
    expect(burndown({ startDate: "2026-10-05", endDate: "2026-10-06", today: "2026-10-06", calendar, committed: [] }).map((day) => [day.remaining, day.ideal])).toEqual([[0, 0], [0, 0]]);
  });
});
