import { describe, expect, it } from "vitest";
import { price } from "./pricing";
import { applyWaste } from "./waste";

const sum = (lines: { amount: string }[]) => lines.reduce((a, l) => a + Number(l.amount) * 1000, 0) / 1000;

describe("pricing", () => {
  it("prices per measure with a minimum charge and shows why", () => {
    const small = price({ method: "per_measure", rate: "40", minimumCharge: "1000" }, { quantity: "12", currencyDecimals: 2 });
    expect(small).toMatchObject({ available: true, total: "1000.00", breakdown: [{ label: "12 × 40.00", amount: "480.00" }, { label: "Minimum charge", amount: "520.00" }] });
  });
  it("adds cost plus markup and attribute surcharges", () => {
    expect(price({ method: "cost_plus", cost: "100", markupPercent: "20" }, { quantity: "50", currencyDecimals: 2 })).toMatchObject({ total: "6000.00", unitPrice: "120.00" });
    const acrylic = price({ method: "attribute_surcharge", base: "800", surcharges: [{ attribute: "finish", value: "acrylic", percent: "12" }, { attribute: "hinge", value: "soft_close", amount: "150", label: "Soft-close" }] },
      { quantity: "2", currencyDecimals: 2, attributes: { finish: "acrylic", hinge: "soft_close" } });
    expect(acrylic).toMatchObject({ total: "2092.00" });
  });
  it("uses the right tier and refuses quantities below the first", () => {
    const tiers = { method: "tiered" as const, tiers: [{ fromQuantity: "10", price: "9" }, { fromQuantity: "1", price: "10" }, { fromQuantity: "100", price: "8" }] };
    expect(price(tiers, { quantity: "150", currencyDecimals: 2 })).toMatchObject({ total: "1200.00" });
    expect(price({ method: "tiered", tiers: [{ fromQuantity: "5", price: "10" }] }, { quantity: "2", currencyDecimals: 2 })).toMatchObject({ available: false });
  });
  it("rolls up an assembly and refuses when a component has no price", () => {
    const wardrobe = price({ method: "assembly_rollup", components: [{ label: "Ply sheet", quantity: "3", unitPrice: "180" }, { label: "Hinge", quantity: "8", unitPrice: "12.5" }], labour: "400", marginPercent: "25" }, { quantity: "1", currencyDecimals: 2 });
    expect(wardrobe).toMatchObject({ total: "1300.00" });
    expect(price({ method: "assembly_rollup", components: [{ label: "Handle", quantity: "2", unitPrice: null }] }, { quantity: "1", currencyDecimals: 2 })).toEqual({ available: false, reason: "Handle has no price" });
  });
  it("keeps the breakdown equal to the total at 3-decimal currencies", () => {
    const result = price({ method: "cost_plus", cost: "0.3333", markupPercent: "33.333" }, { quantity: "7", currencyDecimals: 3 });
    if (!result.available) throw new Error();
    expect(sum(result.breakdown)).toBeCloseTo(Number(result.total), 6);
  });
  it("never prices a missing price as zero", () => {
    expect(price(null, { quantity: "1", currencyDecimals: 2 })).toEqual({ available: false, reason: "No price set" });
  });
});

describe("waste", () => {
  it("adds waste for the quote and rounds purchase to whole sheets", () => {
    const tiles = applyWaste("20", { percent: "8" });
    expect(tiles.quote.toString()).toBe("21.6");
    const sheets = applyWaste("2.3", { percent: "5", roundUpTo: "1" });
    expect([sheets.quote.toString(), sheets.purchase.toString(), sheets.extra.toString()]).toEqual(["2.415", "3", "0.7"]);
  });
});
