import { describe, expect, it } from "vitest";
import type { CatalogPriceSnapshot, QuoteLine } from "./commercial.types";
import { retainedCatalogPrice } from "./commercial.service";

const snapshot: CatalogPriceSnapshot = {
  status: "resolved",
  source: "catalog",
  mode: "fixed",
  catalogId: "catalog",
  work: { id: "work", version: 4 },
  unit: { id: "unit", version: 2 },
  unitLabel: "sq.ft",
  quantity: 10,
  currency: "AED",
  pricingDate: "2026-09-18",
  taxRate: 5,
  resolvedAt: "2026-09-18T00:00:00.000Z",
  rateCard: {
    id: "rate",
    version: 7,
    amount: 100,
    baseUnitRate: 9.29,
    appliedUnitRate: 9.29,
    effectiveFrom: "2026-01-01",
    taxIncluded: false,
    costIncludes: "all_inclusive",
    sourceUnit: {
      id: "sqm",
      version: 3,
      label: "sq.m",
      conversionFactor: 0.09290304,
    },
  },
};
const line = (quantity = 10, unit = "sq.ft"): QuoteLine => ({
  id: "line",
  room: "Living",
  title: "Flooring",
  specification: "",
  material: "",
  finish: "",
  quantity,
  unit,
  unitCost: 0,
  rate: 9.29,
});

describe("catalog price retention", () => {
  it("keeps the exact versioned price evidence when the quote basis is unchanged", () => {
    const retained = retainedCatalogPrice(snapshot, line(), "AED", 5);
    expect(retained).toEqual(snapshot);
    expect(retained).not.toBe(snapshot);
    expect(retained.rateCard).not.toBe(snapshot.rateCard);
  });

  it.each([
    [line(11), "AED", 5],
    [line(), "USD", 5],
    [line(), "AED", 0],
    [line(10, "sq.m"), "AED", 5],
  ])("marks changed quantity, currency, tax or unit stale", (changed, currency, tax) => {
    expect(retainedCatalogPrice(snapshot, changed, currency, tax)).toMatchObject({
      status: "stale",
      issue: { code: "stale" },
      rateCard: { id: "rate", version: 7 },
    });
  });
});
