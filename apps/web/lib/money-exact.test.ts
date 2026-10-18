import { describe, expect, it } from "vitest";
import { paymentMilestoneAmounts } from "@/lib/commercial/client";
import { minorUnits, percentOf, sumExact, taxInside, toMinor } from "./money-exact";

describe("exact money in the currency's minor units", () => {
  it("knows each currency's places and rounds half away from zero from the decimal text", () => {
    expect([minorUnits("AED"), minorUnits("JPY"), minorUnits("KWD"), minorUnits(undefined)]).toEqual([2, 0, 3, 2]);
    // Float cents get 1.005 and 8.675 wrong; the decimal text doesn't.
    expect(toMinor(1.005, "AED")).toBe(101);
    expect(toMinor(8.675, "AED")).toBe(868);
    expect(toMinor("1234.5675", "KWD")).toBe(1234568);
    expect(toMinor(1500.5, "JPY")).toBe(1501);
  });

  it("sums options without float drift (the portal's total with the options the client picks)", () => {
    expect(sumExact([0.1, 0.2, 0.7], "AED")).toBe(1);
    expect(sumExact([1234.567, 0.001], "KWD")).toBe(1234.568);
  });

  it("splits milestones like the server: shares in minor units, the last takes the rest", () => {
    expect(percentOf(1234.567, 20, "KWD")).toBe(246.913);
    expect(paymentMilestoneAmounts(1234.567, [{ percent: 20 }, { percent: 30 }, { percent: 50 }], "KWD")).toEqual([246.913, 370.37, 617.284]);
    expect(paymentMilestoneAmounts(100_001, [{ percent: 30 }, { percent: 70 }], "JPY")).toEqual([30_000, 70_001]);
    expect(paymentMilestoneAmounts(100, [{ percent: 33.34 }, { percent: 33.33 }, { percent: 33.33 }], "AED")).toEqual([33.34, 33.33, 33.33]);
  });

  it("splits a tax-inclusive receipt into net and tax, adding back to the amount", () => {
    expect(taxInside(10_500, 5, "AED")).toEqual({ net: 10_000, tax: 500 });
    expect(taxInside("1000.00", 5, "AED")).toEqual({ net: 952.38, tax: 47.62 });
    expect(taxInside(1000, 0, "AED")).toEqual({ net: 1000, tax: 0 });
    expect(taxInside(11_800, 18, "INR")).toEqual({ net: 10_000, tax: 1800 });
  });
});
