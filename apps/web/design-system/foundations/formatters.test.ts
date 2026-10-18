import { describe, expect, it } from "vitest";
import { formatDate, formatDecimal, formatMeasurement, formatMoney, formatPercent, pluralize } from "./formatters";

describe("international formatters", () => {
  it("formats three supported currencies", () => {
    expect(formatMoney(1250, { locale: "en-AE", currency: "AED" })).toContain("1,250");
    expect(formatMoney(1250, { locale: "en-IN", currency: "INR" })).toContain("1,250");
    expect(formatMoney(1250, { locale: "en-US", currency: "USD" })).toContain("1,250");
  });
  it("formats money from the API's decimal text with the currency's own decimals and the locale's symbol placement", () => {
    const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
    expect(plain(formatMoney("4320.00", { locale: "en-AE", currency: "AED" }))).toBe("AED 4,320.00");
    expect(plain(formatMoney("4320.5", { locale: "en-KW", currency: "KWD" }))).toBe("KWD 4,320.500");
    expect(plain(formatMoney("4320.00", { locale: "de-DE", currency: "EUR" }))).toBe("4.320,00 €");
    expect(plain(formatMoney("+250.00", { locale: "en", currency: "AED" }, { signDisplay: "exceptZero" }))).toBe("+AED 250.00");
    // Exact: a long decimal isn't rounded through a float first.
    expect(formatMoney("12345678901234.56", { locale: "en", currency: "USD" })).toBe("$12,345,678,901,234.56");
  });
  it("formats locale-aware dates and measurements", () => {
    expect(formatDate("2026-09-03T10:00:00Z", { locale: "en-AE", timeZone: "Asia/Dubai" })).toMatch(/Sep|2026/);
    expect(formatMeasurement(2500, "millimeter", { locale: "en-US" })).toContain("2,500");
    expect(formatPercent(0.42, { locale: "en-US" })).toBe("42%");
    expect(pluralize(1, { one: "item", other: "items" }, { locale: "en-US" })).toBe("1 item");
  });
  it("writes a quantity from the API's decimal text without trailing zeros, the locale's way", () => {
    expect(formatDecimal("24.0000", { locale: "en-AE" })).toBe("24");
    expect(formatDecimal("2.5000", { locale: "de-DE" })).toBe("2,5");
    expect(formatDecimal("1250.7500", { locale: "en-IN" })).toBe("1,250.75");
    expect(formatDecimal(null, { locale: "en-AE" })).toBe("");
  });
});
