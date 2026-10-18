import { describe, expect, it } from "vitest";
import { caseCurrency, roundAmount, sameAmount, splitByPercent, sumAmounts } from "./case-money";

describe("case money", () => {
  it("rounds exactly, half away from zero, where float math goes wrong", () => {
    // Math.round(1.005 * 100) / 100 === 1 and Math.round(8.675 * 100) / 100 === 8.67.
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(8.675)).toBe(8.68);
    expect(roundAmount(1234.564)).toBe(1234.56);
  });

  it("rounds to the currency's minor units", () => {
    expect(roundAmount(1500.5, "JPY")).toBe(1501);
    expect(roundAmount(12.3456, "KWD")).toBe(12.346);
    expect(roundAmount(10.005, "INR")).toBe(10.01);
  });

  it("totals without float drift", () => {
    // 0.1 + 0.2 + 0.7 !== 1 in floats; the commission total is exact.
    expect(sumAmounts([0.1, 0.2, 0.7], "AED")).toBe(1);
    expect(sumAmounts([333.335, 333.335], "USD")).toBe(666.67);
  });

  it("splits a total into milestones that always add up, in the currency's minor units", () => {
    // 3 × 33.33 = 99.99: the last milestone takes the remainder.
    expect(splitByPercent(100, [33.34, 33.33, 33.33], "AED")).toEqual([33.34, 33.33, 33.33]);
    expect(splitByPercent(1000.01, [50, 50], "USD")).toEqual([500.01, 500]);
    expect(splitByPercent(100_001, [30, 70], "JPY")).toEqual([30_000, 70_001]);
    const kwd = splitByPercent(1234.567, [20, 30, 50], "KWD");
    expect(kwd).toEqual([246.913, 370.37, 617.284]);
    expect(sumAmounts(kwd, "KWD")).toBe(1234.567);
  });

  it("compares money in minor units, never by float equality", () => {
    expect(sameAmount(0.1 + 0.2, 0.3, "AED")).toBe(true);
    expect(sameAmount(10.004, 10, "AED")).toBe(true);
    expect(sameAmount(10.004, 10, "KWD")).toBe(false);
  });

  it("accepts any ISO 4217 currency and refuses anything else", () => {
    expect(caseCurrency("chf")).toBe("CHF");
    expect(caseCurrency("KES")).toBe("KES");
    expect(() => caseCurrency("XYZ")).toThrow("Choose a supported currency.");
    expect(() => caseCurrency("")).toThrow();
  });
});
