import { describe, expect, it } from "vitest";
import { materialShare } from "./factory";

describe("a work order's share of a material on the project's list", () => {
  it("takes the work order's part of a material used only on its line, rounded up", () => {
    // 3 of the line's 4.5 m uses two thirds of 20 sheets.
    expect(materialShare({ quantity: "20", lineOnly: true, lineQuantity: "4.5" }, "3")).toBe("13.3334");
    expect(materialShare({ quantity: "20.0000", lineOnly: true, lineQuantity: "4.5000" }, "4.5000")).toBe("20.0000");
  });

  it("suggests nothing for a material shared by other items, tied to none, or without a quantity", () => {
    expect(materialShare({ quantity: "4", lineOnly: false, lineQuantity: "4.5" }, "3")).toBeNull();
    expect(materialShare({ quantity: null, lineOnly: true, lineQuantity: "4.5" }, "3")).toBeNull();
    expect(materialShare({ quantity: "4", lineOnly: true, lineQuantity: null }, "3")).toBeNull();
    expect(materialShare({ quantity: "4", lineOnly: true, lineQuantity: "0" }, "3")).toBeNull();
  });
});
