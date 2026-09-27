import { describe, expect, it } from "vitest";
import type { QuoteLine } from "./types";
import { catalogPriceInput, catalogPriceProvenance, catalogResolvedRate, priceBasisCurrent, usesCatalogPricing } from "./catalog-price";

const line: QuoteLine = {
  id: "line", room: "Living", title: "Joinery", specification: "", material: "", finish: "",
  quantity: 2, unit: "nos", unitCost: 0, rate: 350, pricingMode: "item",
  catalogLinks: [{ role: "work", recordId: "work", version: 4, snapshot: {
    id: "work", name: "Joinery", code: "J", kind: "work", version: 4, catalogId: "catalog", commerce: { pricingMode: "fixed" },
  } }],
  catalogPrice: {
    status: "resolved", source: "catalog", mode: "fixed", catalogId: "catalog", work: { id: "work", version: 4 },
    unitLabel: "nos", quantity: 2, currency: "AED", pricingDate: "2026-09-17", taxRate: 5,
    resolvedAt: "2026-09-17T00:00:00Z", rateCard: { id: "rate", version: 2, amount: 350, baseUnitRate: 350,
      appliedUnitRate: 350, effectiveFrom: "2026-01-01", taxIncluded: false, costIncludes: "labour" },
  },
};

describe("catalogue selling-price basis", () => {
  it("passes the selected record versions and sale basis to the backend", () => {
    expect(usesCatalogPricing(line)).toBe(true);
    expect(catalogPriceInput(line, "AED", 5)).toEqual({ catalogId: "catalog", workId: "work", workVersion: 4, unitLabel: "nos", quantity: 2, currency: "AED", taxRate: 5 });
    expect(priceBasisCurrent(line, "AED", 5)).toBe(true);
    expect(catalogResolvedRate(line.catalogPrice!)).toBe(350);
  });

  it("marks quantity, tax, currency, unit and catalogue changes as needing a refresh", () => {
    expect(priceBasisCurrent({ ...line, quantity: 3 }, "AED", 5)).toBe(false);
    expect(priceBasisCurrent(line, "USD", 5)).toBe(false);
    expect(priceBasisCurrent(line, "AED", 0)).toBe(false);
    expect(priceBasisCurrent({ ...line, unit: "sq.ft" }, "AED", 5)).toBe(false);
    expect(priceBasisCurrent({ ...line, catalogLinks: [{ ...line.catalogLinks![0], version: 5 }] }, "AED", 5)).toBe(false);
  });

  it("never treats a required or stale price as a selling rate", () => {
    expect(catalogResolvedRate({ ...line.catalogPrice!, status: "price_required" })).toBe(0);
    expect(priceBasisCurrent({ ...line, catalogPrice: { ...line.catalogPrice!, status: "stale" } }, "AED", 5)).toBe(false);
  });

  it("explains the versioned selling-rate basis without exposing purchase cost", () => {
    expect(catalogPriceProvenance(line.catalogPrice!, { locale: "en-GB" })).toEqual({
      basis: "Catalog rate · v2",
      detail: "Effective 1 Jan 2026 to open ended · priced 17 Sept 2026 · tax extra",
    });
    const manual = catalogPriceProvenance({ ...line.catalogPrice!, source: "manual_override", override: { amount: 425, reason: "Client-approved finish", by: "Operations", at: "2026-09-17T10:00:00Z" } });
    expect(manual?.basis).toBe("Manual override · AED 425.00");
    expect(manual?.detail).toContain("Client-approved finish · Operations");
    expect(JSON.stringify(manual)).not.toContain("unitCost");
  });

  it("shows the pinned source unit and conversion factor", () => {
    const converted = catalogPriceProvenance({
      ...line.catalogPrice!,
      rateCard: {
        ...line.catalogPrice!.rateCard!,
        sourceUnit: {
          id: "sqm",
          version: 3,
          label: "sq.m",
          conversionFactor: 0.09290304,
        },
      },
    });
    expect(converted?.detail).toContain(
      "converted from sq.m v3 (factor 0.09290304)",
    );
  });

  it("surfaces stale evidence and its backend issue", () => {
    const stale = catalogPriceProvenance({ ...line.catalogPrice!, status: "stale", issue: { code: "rate_changed", message: "The selected rate changed." } });
    expect(stale?.issue).toBe("The selected rate changed.");
  });
});
