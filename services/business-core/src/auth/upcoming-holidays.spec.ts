import { describe, expect, it } from "vitest";
import { upcomingHolidays } from "./identity.service";

describe("the working week on the profile", () => {
  it("sends only the days off from yesterday to about a year ahead, in order", () => {
    const now = new Date("2026-09-29T08:00:00Z");
    expect(upcomingHolidays(["2027-12-31", "2026-12-02", "2025-12-02", "2026-09-28", "2026-09-27"], now)).toEqual(["2026-09-28", "2026-12-02"]);
  });
});
