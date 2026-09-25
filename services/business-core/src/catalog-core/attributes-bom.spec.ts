import { describe, expect, it } from "vitest";
import { normalizeAttributeValues, type AttributeDefinition } from "./attributes";
import { assertNoCycle, checkFormulas, explode } from "./bom";

const defs: AttributeDefinition[] = [
  { id: "a1", code: "width", label: "Width", valueType: "dimension", required: true, choices: [], unitCode: "mm" },
  { id: "a2", code: "finish", label: "Finish", valueType: "choice", required: false, choices: [{ value: "acrylic", label: "Acrylic" }, { value: "laminate", label: "Laminate" }], unitCode: null },
  { id: "a3", code: "features", label: "Features", valueType: "multi_choice", required: false, choices: [{ value: "soft_close", label: "Soft close" }, { value: "led", label: "LED" }], unitCode: null },
  { id: "a4", code: "colour", label: "Colour", valueType: "color", required: false, choices: [], unitCode: null },
];

describe("attribute values", () => {
  it("normalizes typed values", () => {
    expect(normalizeAttributeValues(defs, { width: "600.50", finish: "acrylic", features: ["led", "soft_close", "led"], colour: "#aabbcc" }))
      .toEqual([{ attributeId: "a1", value: "600.5" }, { attributeId: "a2", value: "acrylic" }, { attributeId: "a3", value: "led,soft_close" }, { attributeId: "a4", value: "#AABBCC" }]);
  });
  it("explains what is wrong", () => {
    expect(() => normalizeAttributeValues(defs, {})).toThrow("Width is required");
    expect(() => normalizeAttributeValues(defs, { width: "0" })).toThrow("Width must be more than 0");
    expect(() => normalizeAttributeValues(defs, { width: "600", finish: "gold" })).toThrow(/not one of the options/);
    expect(() => normalizeAttributeValues(defs, { width: "600", colour: "red" })).toThrow(/colour like/);
    expect(() => normalizeAttributeValues(defs, { width: "600", depth: "10" })).toThrow("Unknown attribute depth");
  });
});

describe("bill of materials", () => {
  const graph: Record<string, string[]> = { wardrobe: ["carcass", "shutter"], shutter: ["hinge"], hinge: [], carcass: [] };
  it("rejects cycles", () => {
    expect(() => assertNoCycle("hinge", ["wardrobe"], (id) => graph[id] ?? [])).toThrow(/cannot contain itself/);
    expect(() => assertNoCycle("wardrobe", ["carcass", "shutter"], (id) => graph[id] ?? [])).not.toThrow();
  });
  it("checks formulas and lists their inputs", () => {
    expect(checkFormulas([{ componentItemId: "hinge", label: "Hinges", quantityFormula: "ceil(height / 450) * 2", unitCode: "pcs" }])[0].inputs).toEqual(["height"]);
    expect(() => checkFormulas([{ componentItemId: "x", label: "Ply", quantityFormula: "width *", unitCode: "sheet" }])).toThrow(/Ply: Formula ends too early/);
  });
  it("explodes an assembly with waste and whole sheets", () => {
    const rows = explode([
      { componentItemId: "ply", label: "Ply 18mm", quantityFormula: "width * height / 1000000 * 2 / 2.9768", unitCode: "sheet", wastePercent: "10", purchaseRoundTo: "1" },
      { componentItemId: "hinge", label: "Hinges", quantityFormula: "ceil(height / 450) * 2", unitCode: "pcs" },
    ], "2", { width: 1800, height: 2400 });
    expect(rows[1]).toMatchObject({ perAssembly: "12", quantity: "24", purchaseQuantity: "24" });
    expect(Number(rows[0].quantity)).toBeGreaterThan(Number(rows[0].perAssembly) * 2);
    expect(Number(rows[0].purchaseQuantity) % 1).toBe(0);
  });
});
