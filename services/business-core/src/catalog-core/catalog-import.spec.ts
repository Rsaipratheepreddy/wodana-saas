import { describe, expect, it } from "vitest";
import { normalizeUnit, planCatalogImport } from "./catalog-import";

const context = { existingCodes: new Set(["W00004"]), units: new Set<string>(), vendors: new Map([["scientecnic", "v1"]]), defaultCurrency: "AED" };

describe("catalog import plan", () => {
  it("maps spreadsheet units and assumes pieces out loud", () => {
    expect(normalizeUnit("PCS")).toEqual({ unit: "pcs", assumed: false });
    expect(normalizeUnit("LITER")).toEqual({ unit: "l", assumed: false });
    expect(normalizeUnit("")).toEqual({ unit: "pcs", assumed: true });
    expect(normalizeUnit("furlong").unit).toBeNull();
  });
  it("creates, updates, generates codes, links suppliers and explains every assumption", () => {
    const plan = planCatalogImport([
      { line: 3, category: "Woodstock", code: "W00004", name: "White wood 2x2x13'", attributes: { Size: '2" X 2" X 13\'' } },
      { line: 4, category: "Switches", code: "E8331L2_WG", name: "Schneider 1 gang switch", unit: "PCS", supplier: "SCIENTECNIC", cost: "45.50", attributes: { Colour: "WINE GOLD" } },
      { line: 5, category: "Consumables", name: "Teflon tape", unit: "ROLL", supplier: "Unknown Co", cost: "3" },
      { line: 6, category: "Consumables", name: "" },
    ], context);
    expect(plan.rows.map((row) => [row.line, row.action, row.code])).toEqual([[3, "update", "W00004"], [4, "create", "E8331L2_WG"], [5, "create", "CONS-0001"], [6, "skip", ""]]);
    expect(plan.rows[1]).toMatchObject({ supplier: "SCIENTECNIC", cost: "45.5", currency: "AED", attributes: { Colour: "WINE GOLD" } });
    expect(plan.rows[2].messages).toEqual(["Code generated: CONS-0001", 'Supplier "Unknown Co" is not in your supplier list, so no supplier link', "Cost needs a supplier, so it was not kept"]);
    expect(plan.rows[0].messages).toContain("Unit not given, set to pieces");
    expect(plan.summary).toMatchObject({ create: 2, update: 1, skip: 1, error: 0, newUnits: ["roll"] });
  });
  it("never merges two different items that share a code", () => {
    const plan = planCatalogImport([
      { line: 10, category: "Paint", code: "CP 003", name: "CP 003 Catalyst @ 50%" },
      { line: 11, category: "Paint", code: "CP 003", name: "CP 003 Catalyst @ 50% NY" },
      { line: 12, category: "Paint", code: "CP 003", name: "CP 003 catalyst @ 50%" },
    ], context);
    expect(plan.rows.map((row) => row.action)).toEqual(["create", "error", "skip"]);
    expect(plan.rows[1].messages[0]).toBe("Code CP 003 is also used on line 10 for a different item");
  });
});
