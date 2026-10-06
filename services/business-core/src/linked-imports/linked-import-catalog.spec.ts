import { describe, expect, it } from "vitest";
import { codeFromName, headingUnit, sizeCell } from "./linked-import-catalog";

describe("catalog rows from a linked sheet", () => {
  it("makes a new item's code from its name, unique in the catalog", () => {
    const taken = new Set(["aria-sofa"]);
    expect(codeFromName("Aria Sofa", taken)).toBe("ARIA-SOFA-2");
    expect(codeFromName("Aria Sofa", taken)).toBe("ARIA-SOFA-3");
    expect(codeFromName("Crème brûlée – 3 seater", taken)).toBe("CREME-BRULEE-3-SEATER");
    expect(codeFromName("—", taken)).toBe("ITEM");
    expect(codeFromName("x".repeat(120), taken)).toHaveLength(80);
    expect(codeFromName("x".repeat(120), taken)).toMatch(/^X+-2$/);
    expect(codeFromName("x".repeat(120), taken)).toHaveLength(80);
  });

  it("reads one size from a cell, its unit from the cell, the heading or the workspace", () => {
    expect(sizeCell("300 cm", "LENGTH (CM)", "in")).toEqual({ value: "300", unit: "cm" });
    expect(sizeCell("120", "DEPTH (CM)", "in")).toEqual({ value: "120", unit: "cm" });
    expect(sizeCell("120", "Depth", "in")).toEqual({ value: "120", unit: "in" });
    expect(sizeCell("1,200 mm", "Width", "cm")).toEqual({ value: "1200", unit: "mm" });
    expect(sizeCell("110.5 cm ", "Width", "cm")).toEqual({ value: "110.5", unit: "cm" });
    expect(sizeCell("12,5", "Height", "cm")).toEqual({ value: "12.5", unit: "cm" });
    expect(sizeCell("Total H 108. 5 cm - seating H 53 cm / Ottoman L 100 cm x W100 cm", "HEIGHT (CM)", "cm")).toBeNull();
    expect(sizeCell("90 cm - seating H 65 cm", "HEIGHT (CM)", "cm")).toBeNull();
    expect(sizeCell("0 cm", "Height", "cm")).toBeNull();
    expect(sizeCell("12 parsecs", "Height", "cm")).toBeNull();
    expect(headingUnit("HEIGHT (CM)")).toBe("cm");
    expect(headingUnit("Width mm")).toBe("mm");
    expect(headingUnit("Height")).toBeNull();
  });
});
