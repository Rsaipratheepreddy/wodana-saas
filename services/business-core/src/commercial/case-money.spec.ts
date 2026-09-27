import { describe, expect, it } from "vitest";
import { caseCurrency, roundAmount, sumAmounts } from "./case-money";

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

  it("accepts any ISO 4217 currency and refuses anything else", () => {
    expect(caseCurrency("chf")).toBe("CHF");
    expect(caseCurrency("KES")).toBe("KES");
    expect(() => caseCurrency("XYZ")).toThrow("Choose a supported currency.");
    expect(() => caseCurrency("")).toThrow();
  });
});
