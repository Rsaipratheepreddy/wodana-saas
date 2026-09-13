import { describe, expect, it } from "vitest";
import { customUnit, materialNotes, updateMaterials } from "./materials";
import type { CatalogSelection, QuoteLine } from "./types";

const material: CatalogSelection = { role: "material", recordId: "m1", version: 2, snapshot: { id: "m1", name: "Plywood", code: "PLY18", version: 2, kind: "material", catalogId: "cat" } };
const line: QuoteLine = { id: "l1", room: "Kitchen", title: "Cabinet", specification: "18 mm", material: "Plywood · PLY18", finish: "", quantity: 16, unit: "m²", unitCost: 500, rate: 1450, catalogLinks: [material] };
describe("Quotation material relationships", () => {
  it("keeps product identity, custom notes and pricing independent", () => {
    expect(materialNotes(line, "material")).toBe("");
    const changed = updateMaterials(line, "material", [material], "For the carcass ");
    expect(materialNotes(changed, "material")).toBe("For the carcass ");
    const removed = updateMaterials(changed, "material", []);
    expect(removed.material).toBe("For the carcass ");
    expect(removed.catalogLinks).toEqual([]);
    expect(removed.rate).toBe(1450);
    expect(removed.quantity).toBe(16);
    expect(removed.unitCost).toBe(500);
    expect(line.material).toBe("Plywood · PLY18");
  });
  it("preserves an existing custom or imported material specification", () => {
    expect(materialNotes({ ...line, material: "Carcass: Plywood · Brand · 2440 × 1220" }, "material")).toBe("Carcass: Plywood · Brand · 2440 × 1220");
  });
  it("removes an obsolete unit link when the unit is customized", () => {
    const unit: CatalogSelection = { ...material, role: "unit", recordId: "sqm", snapshot: { ...material.snapshot, code: "SQM", configuration: { symbol: "m²" } } };
    const linked = { ...line, catalogLinks: [material, unit] };
    expect(customUnit(linked, "m²").catalogLinks).toHaveLength(2);
    expect(customUnit(linked, "nos").catalogLinks).toEqual([material]);
  });
});
