import { describe, expect, it } from "vitest";
import { formatDate, formatMeasurement, formatMoney, formatPercent, pluralize } from "./formatters";

describe("international formatters", () => {
  it("formats three supported currencies", () => {
    expect(formatMoney(1250, { locale: "en-AE", currency: "AED" })).toContain("1,250");
    expect(formatMoney(1250, { locale: "en-IN", currency: "INR" })).toContain("1,250");
    expect(formatMoney(1250, { locale: "en-US", currency: "USD" })).toContain("1,250");
  });
  it("formats locale-aware dates and measurements", () => {
    expect(formatDate("2026-09-03T10:00:00Z", { locale: "en-AE", timeZone: "Asia/Dubai" })).toMatch(/Sep|2026/);
    expect(formatMeasurement(2500, "millimeter", { locale: "en-US" })).toContain("2,500");
    expect(formatPercent(0.42, { locale: "en-US" })).toBe("42%");
    expect(pluralize(1, { one: "item", other: "items" }, { locale: "en-US" })).toBe("1 item");
  });
});
