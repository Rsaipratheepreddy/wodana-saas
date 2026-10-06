import { describe, expect, it } from "vitest";
import { codeFromName, headingUnit, priceAction, sizeCell } from "./linked-import-catalog";
import { approvedPricesSetting } from "./linked-imports.service";

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

  it("drafts a changed price for review, or puts it live as an approved list price", () => {
    const live = { method: "fixed", price: "9800.000000", cost: "4100.000000", status: "active" };
    const draft = { ...live, status: "draft" };
    expect(priceAction(live, null, true)).toEqual({ kind: "none" });
    expect(priceAction(live, { price: "9800", cost: "4100" }, false)).toEqual({ kind: "none" });
    expect(priceAction(live, { price: "9800", cost: "4100" }, true)).toEqual({ kind: "none" });
    expect(priceAction(live, { price: "10200", cost: "4100" }, false)).toEqual({ kind: "draft", price: "10200", cost: "4100", change: "Price 9800 → 10200 (draft until reviewed)" });
    expect(priceAction(live, { price: "10200", cost: "4300" }, true)).toEqual({ kind: "approve", price: "10200", cost: "4300", change: "Price 9800 → 10200, cost 4100 → 4300" });
    expect(priceAction(undefined, { price: "1950", cost: null }, true)).toMatchObject({ kind: "approve", change: "Price — → 1950" });
    // A draft the sheet repeats stays a draft, unless the prices are approved: then it's approved as it is (no new entry).
    expect(priceAction(draft, { price: "9800", cost: "4100" }, false)).toEqual({ kind: "none" });
    expect(priceAction(draft, { price: "9800", cost: "4100" }, true)).toEqual({ kind: "activate", change: "Price 9800 approved" });
    expect(priceAction({ ...draft, status: "reviewed" }, { price: "9800", cost: "4100" }, true)).toMatchObject({ kind: "activate" });
    // Another method is replaced by the sheet's fixed price.
    expect(priceAction({ method: "per_measure", price: null, cost: null, status: "active" }, { price: "50", cost: null }, true)).toMatchObject({ kind: "approve" });
  });

  it("lets only a member who may approve prices change a link's approved list prices", () => {
    expect(approvedPricesSetting({ requested: true, stored: null, canApprove: true })).toEqual({ value: true, refused: false });
    // Without the permission: a new link drafts, and the preview says why.
    expect(approvedPricesSetting({ requested: true, stored: null, canApprove: false })).toEqual({ value: false, refused: true });
    expect(approvedPricesSetting({ requested: false, stored: null, canApprove: false })).toEqual({ value: false, refused: false });
    // A link that has them keeps them (its runs by this member draft); only an approver turns them off.
    expect(approvedPricesSetting({ requested: true, stored: true, canApprove: false })).toEqual({ value: true, refused: true });
    expect(approvedPricesSetting({ requested: false, stored: true, canApprove: false })).toEqual({ value: true, refused: true });
    expect(approvedPricesSetting({ requested: false, stored: true, canApprove: true })).toEqual({ value: false, refused: false });
    expect(approvedPricesSetting({ requested: true, stored: false, canApprove: false })).toEqual({ value: false, refused: true });
  });
});
