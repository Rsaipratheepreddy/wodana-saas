import { describe, expect, it } from "vitest";
import { formatCalendarDay } from "./calendar-day";

describe("a calendar day in text people read", () => {
  it("follows the workspace's locale, never ISO, without shifting the day", () => {
    expect(formatCalendarDay("2026-10-09", "en-GB")).toBe("9 Oct 2026");
    expect(formatCalendarDay("2026-10-09", "en-US")).toBe("Oct 9, 2026");
    expect(formatCalendarDay("2026-01-01", "en-GB")).toBe("1 Jan 2026");
  });

  it("falls back to English for an unknown locale and keeps a value that isn't a day as it is", () => {
    expect(formatCalendarDay("2026-10-09", "not a locale!")).toBe("Oct 9, 2026");
    expect(formatCalendarDay("someday", "en-GB")).toBe("someday");
  });
});
