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
