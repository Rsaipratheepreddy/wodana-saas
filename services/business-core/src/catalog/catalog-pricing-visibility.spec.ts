import { describe, expect, it } from "vitest";
import { catalogRecordsForViewer, isRestrictedCostRecord } from "./catalog-pricing-visibility";

const records = [
  { id: "item", kind: "work", attributes: [
    { name: "estimated_cost_aed", value: "100" },
    { name: "selling_price_aed", value: "175" },
    { name: "Finish", value: "Oak" },
  ] },
  { id: "cost", kind: "rate_card", configuration: { priceType: "cost", amount: 100 } },
  { id: "purchase", kind: "rate_card", configuration: { priceType: "purchase", amount: 90 } },
  { id: "selling", kind: "rate_card", configuration: { priceType: "selling", amount: 175 } },
  { id: "unknown-rate", kind: "rate_card", configuration: { amount: 80 } },
];

describe("catalog price visibility", () => {
  it("keeps the complete commercial record for a cost-authorized user", () => {
    expect(catalogRecordsForViewer(records, true)).toEqual(records);
  });

  it("keeps product specifications and selling prices but removes supplier/internal costs", () => {
    const visible = catalogRecordsForViewer(records, false);
    expect(visible.map((record) => record.id)).toEqual(["item", "selling"]);
    expect(visible[0].attributes).toEqual([
      { name: "selling_price_aed", value: "175" },
      { name: "Finish", value: "Oak" },
    ]);
  });

  it("treats an unclassified rate as restricted instead of guessing that it is safe", () => {
    expect(isRestrictedCostRecord(records[4])).toBe(true);
  });
});
