import { describe, expect, it } from "vitest";
import { checkRecipeFields, explode, type BomComponent } from "./bom";
import { groupByType, lineMeasurements, recipeRequirements } from "./recipe";

const board: BomComponent = { componentItemId: "b", label: "18mm MDF", quantityFormula: "2", unitCode: "sheet", componentType: "board", wastePercent: "10" };
const foam: BomComponent = { componentItemId: "f", label: "Foam", quantityFormula: "width * 2", unitCode: "sqm", componentType: "foam" };
/** One roll of fabric covers a batch of four chairs. */
const fabric: BomComponent = { componentItemId: "t", label: "Fabric", quantityFormula: "1", unitCode: "roll", componentType: "fabric", quantityBasis: "per_batch", batchSize: "4", purchaseRoundTo: "1" };
const labour: BomComponent = { componentItemId: "l", label: "Upholstery", quantityFormula: "1", unitCode: "hr", componentType: "labour", labourHours: "3.5" };

describe("PLM-162: a structured recipe explodes per unit or per batch, with labour hours", () => {
  it("multiplies per-unit lines by the quantity made, with waste, and spreads a per-batch line over its batch", () => {
    const lines = explode([board, fabric, labour], "6", {});
    expect(lines.find((line) => line.label === "18mm MDF")).toMatchObject({ componentType: "board", perAssembly: "2", quantity: "13.2", hours: null });
    // 1 roll per 4 chairs: 0.25 a chair, 1.5 rolls for 6, bought as 2 whole rolls.
    expect(lines.find((line) => line.label === "Fabric")).toMatchObject({ componentType: "fabric", perAssembly: "0.25", quantity: "1.5", purchaseQuantity: "2" });
    expect(lines.find((line) => line.label === "Upholstery")).toMatchObject({ componentType: "labour", hours: "21" });
  });

  it("checks the recipe fields: a batch needs its size, hours only on labour, kinds from the list", () => {
    expect(checkRecipeFields(fabric)).toEqual({ componentType: "fabric", quantityBasis: "per_batch", batchSize: "4", labourHours: null });
    expect(checkRecipeFields({ ...board, componentType: undefined })).toEqual({ componentType: "other", quantityBasis: "per_unit", batchSize: null, labourHours: null });
    expect(() => checkRecipeFields({ ...fabric, batchSize: null })).toThrow(/how many units a batch makes/);
    expect(() => checkRecipeFields({ ...fabric, batchSize: "0" })).toThrow(/above zero/);
    expect(() => checkRecipeFields({ ...labour, labourHours: "abc" })).toThrow(/number/);
    // Hours on a board line are dropped: only labour has hours.
    expect(checkRecipeFields({ ...board, labourHours: "2" }).labourHours).toBeNull();
    expect(() => checkRecipeFields({ ...board, componentType: "glass" as never })).toThrow(/unknown component kind/);
  });
});

describe("PLM-166: a line's quantities come only from a verified recipe", () => {
  const verified = { at: "2026-10-15T08:00:00.000Z", byName: "Rami Factory" };

  it("gives nothing for an item without a recipe, and 'unverified' when nobody verified it: nothing is guessed", () => {
    expect(recipeRequirements(null, "2", {})).toEqual({ state: "none" });
    expect(recipeRequirements({ components: [], verified }, "2", {})).toEqual({ state: "none" });
    expect(recipeRequirements({ components: [board, labour], verified: null }, "2", {})).toEqual({ state: "unverified", components: 2 });
  });

  it("explodes a verified recipe for the line's quantity, totalling the labour hours", () => {
    const result = recipeRequirements({ components: [board, fabric, labour], verified }, "2", {});
    expect(result.state).toBe("verified");
    if (result.state !== "verified") return;
    expect(result.labourHours).toBe("7");
    expect(result.verified).toEqual(verified);
    expect(groupByType(result.lines).map((group) => [group.type, group.lines.length])).toEqual([["board", 1], ["fabric", 1], ["labour", 1]]);
  });

  it("reports a missing measurement instead of guessing it", () => {
    const result = recipeRequirements({ components: [foam], verified }, "1", {});
    expect(result).toMatchObject({ state: "needs_measurements", problem: expect.stringContaining("width") });
    expect(recipeRequirements({ components: [foam], verified }, "3", lineMeasurements({ width: "1.5", height: null, length: null }))).toMatchObject({ state: "verified" });
  });

  it("takes the quotation line's sizes as the formulas' inputs, with the area when two sides are known", () => {
    expect(lineMeasurements({ width: "2", height: "0.9", length: null })).toEqual({ width: "2", height: "0.9", area: "1.8" });
    expect(lineMeasurements({ width: null, height: null, length: null })).toEqual({});
  });
});
