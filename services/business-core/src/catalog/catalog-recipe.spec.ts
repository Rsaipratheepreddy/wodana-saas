import { describe, expect, it } from "vitest";
import { CATALOG_STARTER } from "./catalog-starter";
import { previewRecipe } from "./catalog-recipe";
import { RecipePreviewDto } from "./catalog.dto";
const starters = () =>
  CATALOG_STARTER.map((r) => ({ ...structuredClone(r), version: 1 }));
const code = (rows: ReturnType<typeof starters>, c: string) =>
  rows.find((r) => r.code === c)!;
const example = (rows: ReturnType<typeof starters>): RecipePreviewDto => ({
  templateId: code(rows, "ICT-WARD").id,
  executionId: code(rows, "EXEC-FACTORY").id,
  variantId: code(rows, "VR-WARD-SLD").id,
  grade: "Premium",
  dimensionUnit: "ft",
  width: 8,
  height: 9,
  quantity: 1,
  currency: "INR",
  values: [
    { key: "opening_sets", value: 1 },
    { key: "jobs", value: 1 },
    { key: "deliveries", value: 1 },
  ],
  commercialRuleIds: [code(rows, "COM-MAR-TGT").id],
});
describe("connected quotation recipes", () => {
  it("resolves the 72 sq.ft sliding wardrobe with factory processes and site installation", () => {
    const rows = starters();
    const result = previewRecipe(rows, example(rows));
    expect(result.measurement).toEqual({ quantity: 72, unit: "Square foot" });
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "HW-SLD-2D").id),
    ).toBe(true);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "HW-HNG-STD").id),
    ).toBe(false);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "FP-CUT-PANEL").id),
    ).toBe(true);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "SP-CARP-INST").id),
    ).toBe(true);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "SP-CARP-FAB").id),
    ).toBe(false);
    expect(
      result.lines.find((l) => l.id === code(rows, "ICT-WARD_CARCASS").id)
        ?.quantity,
    ).toBeNull();
    expect(result.status).toBe("needs_configuration");
    expect(result.priceBeforeTax).toBeNull();
    expect(result.changes.some((c) => c.includes("Merino"))).toBe(true);
  });
  it("routes site fabrication without also billing factory work or separate modular installation", () => {
    const rows = starters();
    const result = previewRecipe(rows, {
      ...example(rows),
      executionId: code(rows, "EXEC-ONSITE").id,
      variantId: undefined,
    });
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "SP-CARP-FAB").id),
    ).toBe(true);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "FP-CUT-PANEL").id),
    ).toBe(false);
    expect(
      result.lines.some((l) => l.sourceId === code(rows, "SP-CARP-INST").id),
    ).toBe(false);
  });
  it("requires the actual hinge count when a set is replaced with individual hardware", () => {
    const rows = starters();
    const input = {
      ...example(rows),
      variantId: code(rows, "VR-WARD-OPEN").id,
    };
    const result = previewRecipe(rows, input);
    const hinges = result.lines.find(
      (l) => l.sourceId === code(rows, "HW-HNG-STD").id,
    )!;
    expect(hinges.unit).toBe("Each");
    expect(hinges.quantity).toBeNull();
    expect(hinges.quantityInput).toBe("qty_hw_hng_std");
    const counted = previewRecipe(rows, {
      ...input,
      values: [
        ...(input.values ?? []),
        { key: hinges.quantityInput, value: 12 },
      ],
    });
    expect(counted.lines.find((l) => l.id === hinges.id)?.quantity).toBe(12);
    expect(
      counted.issues.some((i) => i.includes("connect this variant rule")),
    ).toBe(true);
  });
  it("gives every existing item a linked recipe", () => {
    const rows = starters();
    for (const item of rows.filter((r) => r.kind === "work"))
      expect(
        rows.some(
          (r) =>
            r.kind === "construction" &&
            r.configuration?.recordRole === "template" &&
            r.links.some(
              (l) => l.relation === "work" && l.targetId === item.id,
            ),
        ),
        item.name,
      ).toBe(true);
  });
  it("aggregates matching pack demand before rounding and applies margin correctly", () => {
    const rows = starters();
    const template = code(rows, "ICT-WARD");
    const withoutSlots = rows.filter(
      (r) =>
        !r.links.some(
          (l) => l.relation === "parent" && l.targetId === template.id,
        ),
    );
    const sku = code(rows, "SKU-CENTURY-BWP");
    sku.specificationStatus = "workspace_verified";
    sku.sizes = [
      { label: "Test 32 sq.ft sheet", lengthMm: 2438.4, widthMm: 1219.2 },
    ];
    const margin = code(rows, "COM-MAR-TGT");
    margin.specificationStatus = "workspace_verified";
    margin.configuration = { ruleGroup: "Margin", approvedValue: 25 };
    const area = code(rows, "SQUARE_FOOT"),
      sheet = code(rows, "SHEET");
    const rate = {
      ...structuredClone(sku),
      id: "rate",
      kind: "rate_card",
      code: "TEST_RATE",
      name: "Test sheet rate",
      sizes: [],
      configuration: {
        amount: 100,
        currency: "INR",
        effectiveFrom: "2026-09-01",
        priceType: "cost",
        costIncludes: "supply_only",
        taxIncluded: "no",
      },
      links: [
        { relation: "sku", targetId: sku.id },
        { relation: "unit", targetId: sheet.id },
      ],
    };
    const slot = (id: string) => ({
      ...structuredClone(template),
      id,
      code: id,
      name: id,
      configuration: {
        recordRole: "component",
        required: "required",
        quantityBasis: "manual",
        quantityInput: id,
        factor: 1,
      },
      links: [
        { relation: "parent", targetId: template.id },
        { relation: "sku", targetId: sku.id },
        { relation: "unit", targetId: area.id },
      ],
    });
    const configured = [...withoutSlots, rate, slot("panelA"), slot("panelB")];
    const input = {
      ...example(rows),
      variantId: undefined,
      pricingDate: "2026-09-07",
      values: [
        { key: "panelA", value: 10 },
        { key: "panelB", value: 10 },
      ],
    };
    const result = previewRecipe(configured, input);
    expect(result.issues).toEqual([]);
    expect(result.directCost).toBe(100);
    expect(result.priceBeforeTax).toBe(133.33);
    expect(result.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)).toBe(100);
    expect(
      previewRecipe(configured, { ...input, currency: "AED" }).priceBeforeTax,
    ).toBeNull();
    expect(
      previewRecipe(configured, { ...input, pricingDate: "2026-01-01" })
        .priceBeforeTax,
    ).toBeNull();
    expect(
      previewRecipe(
        configured.map((row) =>
          row.id === rate.id
            ? {
                ...row,
                configuration: { ...row.configuration, priceType: "selling" },
              }
            : row,
        ),
        input,
      ).directCost,
    ).toBeNull();
  });
  it("rejects foreign selections, duplicate inputs and invalid dates", () => {
    const rows = starters();
    const input = example(rows);
    expect(() =>
      previewRecipe(rows, { ...input, templateId: "unavailable" }),
    ).toThrow("workspace");
    expect(() =>
      previewRecipe(rows, {
        ...input,
        values: [
          { key: "jobs", value: 1 },
          { key: "jobs", value: 2 },
        ],
      }),
    ).toThrow("duplicate");
    expect(() =>
      previewRecipe(rows, { ...input, pricingDate: "2026-02-31" }),
    ).toThrow("valid pricing date");
  });
});
