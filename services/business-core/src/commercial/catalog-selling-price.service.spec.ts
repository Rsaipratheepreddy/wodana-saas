import { describe, expect, it, vi } from "vitest";
import {
  CatalogSellingPriceService,
  resolveSellingPrice,
  type SellingPriceRecord,
  type SellingPriceRequest,
} from "./catalog-selling-price.service";

const catalogId = "catalog";
const record = (
  value: Partial<SellingPriceRecord> & Pick<SellingPriceRecord, "id" | "kind">,
): SellingPriceRecord => ({
  catalogId,
  code: value.id,
  name: value.id,
  version: 1,
  specificationStatus: "workspace_verified",
  links: [],
  ...value,
});
const work = record({
  id: "work",
  kind: "work",
  commerce: { pricingMode: "fixed" },
  links: [{ relation: "unit", targetId: "unit" }],
});
const unit = record({ id: "unit", kind: "unit", dimension: "count", baseFactor: 1, configuration: { symbol: "nos" } });
const request: SellingPriceRequest = {
  catalogId,
  workId: "work",
  workVersion: 1,
  quantity: 2,
  currency: "AED",
  pricingDate: "2026-09-15",
  taxRate: 5,
};
const rate = (
  id: string,
  configuration: Record<string, unknown> = {},
  links: SellingPriceRecord["links"] = [],
) =>
  record({
    id,
    kind: "rate_card",
    specificationStatus: "workspace_verified",
    configuration: {
      amount: 100,
      currency: "AED",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      priceType: "selling",
      taxIncluded: "no",
      costIncludes: "all_inclusive",
      ...configuration,
    },
    links: [
      { relation: "work", targetId: "work" },
      { relation: "unit", targetId: "unit" },
      ...links,
    ],
  });

describe("catalog selling-price resolution", () => {
  it("resolves one verified current selling rate and freezes its evidence", () => {
    const result = resolveSellingPrice([work, unit, rate("rate")], request);
    expect(result).toMatchObject({ status: "resolved", code: "resolved" });
    expect(result.snapshot).toMatchObject({
      source: "catalog",
      mode: "fixed",
      work: { id: "work", version: 1 },
      unit: { id: "unit", version: 1 },
      quantity: 2,
      currency: "AED",
      rateCard: {
        id: "rate",
        version: 1,
        amount: 100,
        baseUnitRate: 100,
        appliedUnitRate: 100,
      },
    });
  });

  it("keeps an earlier price snapshot reproducible after the rate book changes", () => {
    const original = resolveSellingPrice([work, unit, rate("rate", { amount: 100 })], request).snapshot;
    const revised = resolveSellingPrice([work, unit, { ...rate("rate", { amount: 120 }), version: 2 }], request).snapshot;
    expect(original.rateCard).toMatchObject({ id: "rate", version: 1, amount: 100, appliedUnitRate: 100 });
    expect(revised.rateCard).toMatchObject({ id: "rate", version: 2, amount: 120, appliedUnitRate: 120 });
    expect(original.rateCard?.amount).toBe(100);
  });

  it("never treats purchase, cost, draft or archived rates as selling prices", () => {
    const records = [
      work,
      unit,
      rate("purchase", { priceType: "purchase" }),
      rate("cost", { priceType: "cost" }),
      { ...rate("draft"), specificationStatus: "needs_specification" },
      { ...rate("archived"), archived: true },
    ];
    expect(resolveSellingPrice(records, request)).toMatchObject({
      status: "price_required",
      code: "missing_rate",
    });
  });

  it("ignores otherwise-valid rates from another catalog", () => {
    expect(
      resolveSellingPrice(
        [work, unit, { ...rate("foreign"), catalogId: "other-catalog" }],
        request,
      ).code,
    ).toBe("missing_rate");
  });

  it("uses a variant rate first and falls back to the work rate only when needed", () => {
    const variant = record({
      id: "variant",
      kind: "variant",
      links: [{ relation: "work", targetId: "work" }],
    });
    const variantRate = rate("variant-rate", { amount: 130 }, [
      { relation: "variant", targetId: "variant" },
    ]);
    variantRate.links = variantRate.links.filter(
      (link) => link.relation !== "work",
    );
    const variantRequest = {
      ...request,
      variantId: "variant",
      variantVersion: 1,
    };
    expect(
      resolveSellingPrice(
        [work, unit, variant, rate("work-rate"), variantRate],
        variantRequest,
      ).snapshot.rateCard?.id,
    ).toBe("variant-rate");
    expect(
      resolveSellingPrice(
        [work, unit, variant, rate("work-rate")],
        variantRequest,
      ).snapshot.rateCard?.id,
    ).toBe("work-rate");
  });

  it("prefers an exact zone and the highest eligible quantity tier", () => {
    const zone = record({ id: "zone", kind: "rate_zone" });
    const global = rate("global", { amount: 100 });
    const zoneBase = rate("zone-base", { amount: 90 }, [
      { relation: "rate_zone", targetId: "zone" },
    ]);
    const zoneTier = rate(
      "zone-tier",
      { amount: 80, minimumQuantity: 10 },
      [{ relation: "rate_zone", targetId: "zone" }],
    );
    expect(
      resolveSellingPrice(
        [work, unit, zone, global, zoneBase, zoneTier],
        {
          ...request,
          rateZoneId: "zone",
          rateZoneVersion: 1,
          quantity: 12,
        },
      ).snapshot.rateCard?.id,
    ).toBe("zone-tier");
  });

  it("applies minimum charge and normalizes tax-inclusive catalog rates", () => {
    const result = resolveSellingPrice(
      [
        work,
        unit,
        rate("rate", {
          amount: 105,
          minimumCharge: 525,
          taxIncluded: "yes",
        }),
      ],
      request,
    );
    expect(result.snapshot.rateCard).toMatchObject({
      amount: 105,
      baseUnitRate: 100,
      minimumCharge: 500,
      appliedUnitRate: 250,
      taxIncluded: true,
    });
  });

  it("does not guess when current rates overlap", () => {
    expect(
      resolveSellingPrice(
        [work, unit, rate("one"), rate("two")],
        request,
      ),
    ).toMatchObject({ status: "price_required", code: "ambiguous_rate" });
  });

  it("requires a verified sellable item and matching quotation unit", () => {
    expect(
      resolveSellingPrice(
        [
          { ...work, specificationStatus: "needs_specification" },
          unit,
          rate("rate"),
        ],
        request,
      ).code,
    ).toBe("item_unverified");
    expect(
      resolveSellingPrice([work, unit, rate("rate")], {
        ...request,
        unitLabel: "sqm",
      }).code,
    ).toBe("unit_mismatch");
  });

  it("returns actionable date, currency and unit diagnostics", () => {
    expect(
      resolveSellingPrice(
        [work, unit, rate("old", { effectiveTo: "2026-02-01" })],
        request,
      ).code,
    ).toBe("no_current_rate");
    expect(
      resolveSellingPrice(
        [work, unit, rate("usd", { currency: "USD" })],
        request,
      ).code,
    ).toBe("currency_mismatch");
    expect(
      resolveSellingPrice(
        [
          work,
          unit,
          {
            ...rate("other-unit"),
            links: [
              { relation: "work", targetId: "work" },
              { relation: "unit", targetId: "another-unit" },
            ],
          },
        ],
        request,
      ).code,
    ).toBe("unit_mismatch");
  });

  it("converts compatible physical units from a pinned source unit without guessing packs", () => {
    const squareFoot = record({ id: "sqft", kind: "unit", dimension: "area", baseFactor: 0.09290304, configuration: { symbol: "sq.ft" } });
    const squareMetre = record({ id: "sqm", kind: "unit", dimension: "area", baseFactor: 1, configuration: { symbol: "sq.m" } });
    const areaWork = { ...work, links: [{ relation: "unit", targetId: "sqft" }] };
    const areaRate = rate("area-rate", { amount: 100 }, []);
    areaRate.links = [{ relation: "work", targetId: "work" }, { relation: "unit", targetId: "sqm" }];
    const result = resolveSellingPrice([areaWork, squareFoot, squareMetre, areaRate], { ...request, unitId: "sqft", unitVersion: 1, unitLabel: "sq.ft", quantity: 10 });
    expect(result.snapshot.rateCard).toMatchObject({ amount: 100, baseUnitRate: 9.29, appliedUnitRate: 9.29, sourceUnit: { id: "sqm", version: 1, label: "sq.m", conversionFactor: 0.09290304 } });

    const sheet = record({ id: "sheet", kind: "unit", dimension: "pack", configuration: { symbol: "sheet" } });
    const packRate = { ...areaRate, links: [{ relation: "work", targetId: "work" }, { relation: "unit", targetId: "sheet" }] };
    expect(resolveSellingPrice([areaWork, squareFoot, sheet, packRate], { ...request, unitId: "sqft", unitVersion: 1, unitLabel: "sq.ft" })).toMatchObject({ status: "price_required", code: "unit_mismatch" });
  });

  it("keeps on-request and unpriced items explicit rather than converting them to zero-price products", () => {
    expect(
      resolveSellingPrice(
        [{ ...work, commerce: { pricingMode: "on_request" } }, unit],
        request,
      ),
    ).toMatchObject({ status: "price_required", code: "price_required" });
    expect(
      resolveSellingPrice(
        [{ ...work, commerce: { pricingMode: "unpriced" } }, unit],
        request,
      ),
    ).toMatchObject({ status: "unpriced", code: "unpriced" });
  });

  it("rejects a variant outside the selected item", () => {
    const variant = record({
      id: "variant",
      kind: "variant",
      links: [{ relation: "work", targetId: "other-work" }],
    });
    expect(() =>
      resolveSellingPrice([work, unit, variant], {
        ...request,
        variantId: "variant",
        variantVersion: 1,
      }),
    ).toThrow(/does not belong/);
  });

  it("rejects a stale or unavailable selected variant version", () => {
    const variant = record({ id: "variant", kind: "variant", version: 2, links: [{ relation: "work", targetId: "work" }] });
    expect(() => resolveSellingPrice([work, unit, variant], { ...request, variantId: "variant", variantVersion: 1 })).toThrow(/does not belong|variant/i);
    expect(() => resolveSellingPrice([work, unit, { ...variant, archived: true }], { ...request, variantId: "variant", variantVersion: 2 })).toThrow(/does not belong|variant/i);
  });

  it("loads only workspace-scoped catalog records and never supplier offers", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [work, unit] })
      .mockResolvedValueOnce({ rows: [rate("rate")] });
    const result = await new CatalogSellingPriceService().resolve(
      { query } as never,
      "workspace-a",
      request,
    );
    expect(result.status).toBe("resolved");
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, parameters] of query.mock.calls) {
      expect(sql).toContain("workspace_id=$1");
      expect(sql).not.toContain("workspace_supplier_offers");
      expect(parameters[0]).toBe("workspace-a");
    }
  });

  it("loads a rate unit from the same workspace before converting it", async () => {
    const squareFoot = record({
      id: "sqft",
      kind: "unit",
      dimension: "area",
      baseFactor: 0.09290304,
      configuration: { symbol: "sq.ft" },
    });
    const squareMetre = record({
      id: "sqm",
      kind: "unit",
      dimension: "area",
      baseFactor: 1,
      configuration: { symbol: "sq.m" },
    });
    const areaWork = {
      ...work,
      links: [{ relation: "unit", targetId: "sqft" }],
    };
    const areaRate = rate("area-rate", { amount: 100 });
    areaRate.links = [
      { relation: "work", targetId: "work" },
      { relation: "unit", targetId: "sqm" },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [areaWork, squareFoot] })
      .mockResolvedValueOnce({ rows: [areaRate] })
      .mockResolvedValueOnce({ rows: [squareMetre] });

    const result = await new CatalogSellingPriceService().resolve(
      { query } as never,
      "workspace-a",
      {
        ...request,
        unitId: "sqft",
        unitVersion: 1,
        unitLabel: "sq.ft",
      },
    );

    expect(result.snapshot.rateCard).toMatchObject({
      baseUnitRate: 9.29,
      sourceUnit: { id: "sqm", conversionFactor: 0.09290304 },
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain("r.workspace_id=$1");
    expect(query.mock.calls[2][1]).toEqual([
      "workspace-a",
      catalogId,
      ["sqm"],
    ]);
  });
});
