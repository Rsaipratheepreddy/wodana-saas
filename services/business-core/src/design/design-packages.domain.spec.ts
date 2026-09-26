import { describe, expect, it } from "vitest";
import { checkDesignPackage, depositMeetsMinimum, designFee } from "./design-packages.domain";

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
});
