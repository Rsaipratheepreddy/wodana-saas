import { describe, expect, it } from "vitest";
import { checkDesignPackage, depositMeetsMinimum, depositPercentProblem, designFee, effectiveMinimumDeposit, minimumDepositAmount } from "./design-packages.domain";

describe("design packages (PLM-041)", () => {
  it("prices per space, per area and fixed without floating point", () => {
    expect(designFee({ pricingMethod: "per_space", rate: "10000.00" }, { spaces: 3 })).toBe("30000.00");
    expect(designFee({ pricingMethod: "per_area", rate: "40.00" }, { area: "1234.5" })).toBe("49380.00");
    expect(designFee({ pricingMethod: "per_area", rate: "0.10" }, { area: "0.3" })).toBe("0.03");
    expect(designFee({ pricingMethod: "fixed", rate: "7500" }, {})).toBe("7500.00");
  });

  it("asks for the measure the package needs", () => {
    expect(() => designFee({ pricingMethod: "per_space", rate: "1" }, { spaces: 0 })).toThrow(/spaces/);
    expect(() => designFee({ pricingMethod: "per_area", rate: "1" }, { area: null })).toThrow(/area/);
  });

  it("validates a price-list entry and normalises money", () => {
    expect(checkDesignPackage({ code: "Bespoke", name: "  Bespoke  design ", pricingMethod: "per_area", rate: "40", currency: "AED", areaUnit: "sqft", includesRenders: true }))
      .toMatchObject({ code: "bespoke", name: "Bespoke design", rate: "40.00", areaUnit: "sqft", includedRevisions: 2, includesRenders: true });
    expect(() => checkDesignPackage({ code: "x", name: "X", pricingMethod: "per_area", rate: "1", currency: "AED" })).toThrow();
    expect(() => checkDesignPackage({ code: "concept", name: "Concept", pricingMethod: "per_space", rate: "1.234", currency: "AED" })).toThrow(/rate/);
    expect(checkDesignPackage({ code: "concept", name: "Concept", pricingMethod: "per_space", rate: "10000", currency: "USD", areaUnit: "sqft" }).areaUnit).toBeNull();
  });

  it("checks the minimum deposit in the quote's own currency", () => {
    expect(depositMeetsMinimum(15000, { amount: "15000.00", currency: "AED" }, "AED")).toBe(true);
    expect(depositMeetsMinimum("14999.99", { amount: "15000.00", currency: "AED" }, "AED")).toBe(false);
    expect(depositMeetsMinimum(20000, { amount: "15000.00", currency: "AED" }, "USD")).toBe(false);
    expect(depositMeetsMinimum(0, null, "USD")).toBe(true);
  });

  it("treats an empty or zero minimum deposit as no minimum, never as 0", () => {
    expect(effectiveMinimumDeposit(undefined)).toBeNull();
    expect(effectiveMinimumDeposit(null)).toBeNull();
    expect(effectiveMinimumDeposit({ amount: null, currency: null })).toBeNull();
    expect(effectiveMinimumDeposit({ amount: "", currency: "AED" })).toBeNull();
    expect(effectiveMinimumDeposit({ amount: "0", currency: "AED" })).toBeNull();
    expect(effectiveMinimumDeposit({ amount: "0.00", currency: "AED" })).toBeNull();
    expect(effectiveMinimumDeposit({ amount: "15000", currency: "AED" })).toEqual({ amount: "15000.00", currency: "AED" });
    expect(depositMeetsMinimum(0, effectiveMinimumDeposit({ amount: "0.00", currency: "AED" }), "USD")).toBe(true);
  });

  it("takes the minimum deposit as a share of the design fee, in any currency (Palm: 100%)", () => {
    expect(effectiveMinimumDeposit({ amount: null, currency: null, percent: "100.00" })).toEqual({ percent: "100.00" });
    expect(effectiveMinimumDeposit({ percent: 50 })).toEqual({ percent: "50.00" });
    expect(effectiveMinimumDeposit({ percent: "0" })).toBeNull();
    const whole = { percent: "100.00" };
    expect(minimumDepositAmount(whole, 24000)).toBe("24000.00");
    expect(depositMeetsMinimum("23999.99", whole, "AED", 24000)).toBe(false);
    expect(depositMeetsMinimum(24000, whole, "AED", "24000.00")).toBe(true);
    expect(depositMeetsMinimum(1000, whole, "USD", 1000)).toBe(true);
    // Rounded to the cent: 12.5% of 99.99 is 12.49875.
    expect(minimumDepositAmount({ percent: "12.50" }, "99.99")).toBe("12.50");
    expect(minimumDepositAmount({ percent: "33.33" }, "1000.00")).toBe("333.30");
    expect(depositMeetsMinimum("333.29", { percent: "33.33" }, "AED", "1000.00")).toBe(false);
    expect(depositPercentProblem(100)).toBeNull();
    expect(depositPercentProblem("12.5")).toBeNull();
    expect(depositPercentProblem(0)).toMatch(/more than 0%/);
    expect(depositPercentProblem(101)).toMatch(/at most 100%/);
    expect(depositPercentProblem("ten")).toMatch(/percentage/);
  });
});
