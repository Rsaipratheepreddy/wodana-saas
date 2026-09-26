import { describe, expect, it } from "vitest";
import { validateProposal, type QuoteAiContext } from "./quote-ai";

const context: QuoteAiContext = {
  currency: "AED",
  areas: [{ id: "k", name: "Kitchen" }, { id: "l", name: "Living room" }],
  trades: [{ id: "j", name: "Joinery" }],
  catalog: [{ id: "c1", code: "WRD-H", name: "Wardrobe · hinged", type: "assembly", unit: "nos", category: "Joinery", priced: true }],
  requirements: [], measurements: [], designs: [],
  lines: [{ id: "x", title: "TV unit", area: "Living room", trade: "Joinery", quantity: "1", unit: "nos", kind: "item", version: 4 }],
};

describe("AI proposal validation", () => {
  it("maps catalog codes, areas and trades, and keeps formulas that parse", () => {
    const proposal = validateProposal({ summary: "Draft", changes: [
      { action: "add", code: "wrd-h", area: "kitchen", trade: "Joinery", quantity: 2, width: 1.2, height: 2.4, formula: "count", why: "Brief asks for wardrobes" },
      { action: "add", code: null, title: "Paint walls", area: "Study", trade: "Painting", kind: "service", quantity: 40, unit: "sqm", formula: "depth * 2", why: "" },
    ] }, context, ["add"]);
    expect(proposal.changes[0]).toMatchObject({ catalogItemId: "c1", priced: true, fields: { areaId: "k", workPackageId: "j", quantity: "2", width: "1.2", height: "2.4", formula: "count" } });
    expect(proposal.changes[0].fields.title).toBeUndefined();
    // Unknown area goes to General and is reported; unknown trade is dropped; a bad formula is left out.
    expect(proposal.changes[1]).toMatchObject({ catalogItemId: null, unknownArea: "Study", fields: { title: "Paint walls", areaId: null, workPackageId: null, kind: "service", quantity: "40", unit: "sqm" } });
    expect(proposal.changes[1].fields.formula).toBeUndefined();
  });

  it("only allows the requested actions on lines that exist, with their version", () => {
    const proposal = validateProposal({ summary: "", changes: [
      { action: "move", lineId: "x", area: "Kitchen" }, { action: "remove", lineId: "missing" }, { action: "update", lineId: "x", quantity: 2 }, { action: "remove", lineId: "x" },
    ] }, context, ["add", "update", "move", "remove"]);
    expect(proposal.changes.map((change) => [change.action, change.lineId, change.lineVersion])).toEqual([["move", "x", 4], ["update", "x", 4], ["remove", "x", 4]]);
    expect(validateProposal({ changes: [{ action: "remove", lineId: "x" }] }, context, ["add"]).changes).toEqual([]);
  });

  it("refuses answers that aren't a change list, and never keeps a price", () => {
    expect(() => validateProposal({ lines: [] }, context, ["add"])).toThrow();
    const proposal = validateProposal({ changes: [{ action: "add", title: "Sofa", rate: 9999, quantity: 1, unit: "nos" }] }, context, ["add"]);
    expect(JSON.stringify(proposal)).not.toContain("9999");
  });
});
