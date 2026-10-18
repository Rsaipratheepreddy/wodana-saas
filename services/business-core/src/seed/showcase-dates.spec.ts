import { describe, expect, it } from "vitest";
import { dateAt, dayFrom, todayIn } from "./showcase";

describe("showcase dates on the workspace's calendar", () => {
  // 20:05 UTC on 12 Oct is already 13 Oct in Dubai and India: the product dates a send "13 Oct" there.
  const night = new Date("2026-10-12T20:05:00Z");

  it("counts days from the workspace's today, not UTC's", () => {
    expect(todayIn("UTC", night)).toBe("2026-10-12");
    expect(dayFrom(0, "Asia/Dubai", night)).toBe("2026-10-13");
    expect(dayFrom(-1, "Asia/Kolkata", night)).toBe("2026-10-12");
    expect(dayFrom(2, "America/New_York", night)).toBe("2026-10-14");
    expect(dayFrom(0, undefined, night)).toBe("2026-10-12");
  });

  it("puts a moment at the hour on the workspace's clock", () => {
    const at = dateAt(0, 17, "Asia/Dubai");
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)).toBe("17:00");
    expect(todayIn("Asia/Dubai", at)).toBe(dayFrom(0, "Asia/Dubai"));
  });
});
