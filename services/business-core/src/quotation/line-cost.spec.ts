import { describe, expect, it } from "vitest";
import { applyFields } from "./quotation-builder.service";

const context = { canEditCosts: true, areas: new Map(), trades: new Set<string>(), taxes: new Map(), requirements: new Set<string>(), columns: new Map() };
const line = (fields: Record<string, unknown>) => ({
  id: "l", position: 0, version: 1, kind: "item", areaId: null, fromAreaId: null, workPackageId: null, title: "Design fee", description: "", unit: "",
  quantity: "1", formula: null, length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "0", unitCost: null,
  markupPercent: "35", pricingMode: "rate", discountKind: null, discountValue: null, taxCode: null, taxRate: null, optional: null,
  optionGroup: null, note: "", catalogItemId: null, catalogSnapshot: null, updatedAt: "", updatedByName: null, imageAssetId: null, catalogImageId: null,
  changeOp: null, boqLineId: null, scopeId: null, material: "", values: {}, ...fields,
}) as Parameters<typeof applyFields>[0];

describe("a line's cost and its sell rate", () => {
  it("keeps a rate Sales typed when the QS enters the cost afterwards", () => {
    const next = applyFields(line({ rate: "25000" }), { unitCost: "12000" }, context);
    expect(next.rate).toBe("25000");
    expect(next.unitCost).toBe("12000");
  });

  it("prices a line with no rate yet from cost plus markup", () => {
    expect(applyFields(line({}), { unitCost: "12000" }, context).rate).toBe("16200");
  });

  it("keeps following cost plus markup once the rate came from them", () => {
    expect(applyFields(line({ rate: "16200", unitCost: "12000" }), { unitCost: "10000" }, context).rate).toBe("13500");
  });

  it("re-prices from the cost when the markup itself changes", () => {
    expect(applyFields(line({ rate: "25000", unitCost: "12000" }), { markupPercent: "50" }, context).rate).toBe("18000");
  });
});
