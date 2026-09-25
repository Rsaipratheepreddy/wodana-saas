import { describe, expect, it } from "vitest";
import { validateClean } from "./catalog-ai";

const rows = [
  { line: 3, name: "WHITE WOOD 2\"X2\"X13' [AED 15.50/PCS] - 522 PCS/BDL - HALF BDL", category: "Timber & boards", attributes: { Size: "2\" X 2\" X 13'" } },
  { line: 4, name: "Teflon Tape", category: "Consumables" },
];

describe("AI clean-up validation", () => {
  it("keeps real improvements and drops what was not asked or allowed", () => {
    const result = validateClean({ rows: [
      { line: 3, name: "White wood 2\" × 2\" × 13'", size: "2\" X 2\" X 13'", note: "Price in text: AED 15.50 per piece; 522 pcs per bundle", unit: "PCS" },
      { line: 4, name: "Teflon Tape", unit: "roll", category: "Plumbing" },
      { line: 99, name: "Invented row" },
      { line: 4, category: "Made-up category" },
    ] }, rows, ["Timber & boards", "Consumables", "Plumbing"]);
    expect(result).toEqual([
      { line: 3, name: "White wood 2\" × 2\" × 13'", note: "Price in text: AED 15.50 per piece; 522 pcs per bundle", unit: "pcs" },
      { line: 4, unit: "roll", category: "Plumbing" },
    ]);
  });
  it("rejects an answer with the wrong shape", () => {
    expect(() => validateClean([{ line: 3 }], rows, [])).toThrow(/did not fit/);
  });
});

import { formulaInputs, parseFormula } from "./formula";
import { validateComponents } from "./catalog-ai";

describe("AI component suggestions", () => {
  const candidates = [{ id: "ply", name: "Ply 18mm", unitCode: "sqm" }, { id: "hinge", name: "Hinge", unitCode: "pcs" }];
  const parse = (formula: string) => formulaInputs(parseFormula(formula));
  it("keeps real items with safe formulas and drops invented items, unknown variables and code", () => {
    const result = validateComponents({ components: [
      { itemId: "ply", formula: "width * height / 1000000 * 2", unit: "sqm", reason: "Two side panels" },
      { itemId: "hinge", formula: "ceil(height / 450) * doors", unit: "pcs" },
      { itemId: "ghost", formula: "1" },
      { itemId: "hinge", formula: "require('fs')" },
      { itemId: "hinge", formula: "ceil(height / 450) * 2", unit: "boxes", reason: "Hinges by height" },
    ] }, candidates, parse, ["sqm", "pcs"]);
    expect(result).toEqual([
      { componentItemId: "ply", name: "Ply 18mm", quantityFormula: "width * height / 1000000 * 2", unitCode: "sqm", reason: "Two side panels" },
      { componentItemId: "hinge", name: "Hinge", quantityFormula: "ceil(height / 450) * 2", unitCode: "pcs", reason: "Hinges by height" },
    ]);
  });
});
