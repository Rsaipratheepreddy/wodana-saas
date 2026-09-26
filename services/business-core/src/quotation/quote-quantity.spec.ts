import { describe, expect, it } from "vitest";
import { buildUp, checkFormula, lineQuantity } from "./quote-quantity";

describe("line quantity", () => {
  it("works out a formula over the measurements", () => {
    expect(lineQuantity({ formula: "area * 1.05", length: "4", width: "3", quantity: 0 })).toMatchObject({ quantity: "12.6", error: null });
    expect(lineQuantity({ formula: "ceil(perimeter / 0.6)", length: "4", width: "3", quantity: 0 }).quantity).toBe("24");
    expect(lineQuantity({ formula: "l * h * n", length: "2.4", height: "2.6", count: "2", quantity: 0 }).quantity).toBe("12.48");
  });
  it("keeps the typed quantity and says why when a formula can't be worked out", () => {
    expect(lineQuantity({ formula: "area", length: "4", quantity: 7 })).toMatchObject({ quantity: "7", error: "area has no value" });
    expect(lineQuantity({ formula: "depth * 2", quantity: 3 })).toMatchObject({ quantity: "3", error: "Unknown value: depth" });
    expect(lineQuantity({ quantity: "5" })).toMatchObject({ quantity: "5", formula: null });
    expect(() => checkFormula("thickness * 2")).toThrow(/Unknown value/);
  });
});

describe("materials build-up", () => {
  it("sums what one unit is made of, with waste, markup and client-supplied rows", () => {
    const result = buildUp([
      { name: "Plywood 18 mm", quantityFormula: "height * 1", unitCost: "40", wastePercent: "10" },
      { name: "Laminate", quantity: "2", unitCost: "10", rate: "25" },
      { name: "Client's handles", quantity: "4", unitCost: "5", suppliedByClient: true },
    ], { height: "2" }, "50", 2);
    // plywood 2 × 1.1 = 2.2 × (40 × 1.5 = 60) = 132; laminate 2 × 25 = 50; handles 0
    expect(result.rate).toBe("182.00");
    expect(result.cost).toBe("108.00");
    expect(result.complete).toBe(true);
    expect(result.components[0]).toMatchObject({ quantity: "2.2", rate: "60.00", amount: "132.00" });
  });
  it("marks the build-up incomplete when a row has no price", () => {
    const result = buildUp([{ name: "Stone", quantity: "1" }], {}, null, 2);
    expect(result).toMatchObject({ complete: false, cost: null, rate: "0.00" });
  });
});
