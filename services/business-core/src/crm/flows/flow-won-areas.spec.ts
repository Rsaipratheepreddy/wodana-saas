import { describe, expect, it } from "vitest";
import { areasFor, effectiveWonAreas, isFurnitureDefinition, parseWonAreas, shownAreas } from "./flow-won-areas";

describe("areas after Won per enquiry-type path (PLM-098)", () => {
  it("default to every area, so a workspace that never set them sees what it saw", () => {
    expect(areasFor([], null)).toEqual(["planning", "production", "supply", "delivery", "selection"]);
    expect(areasFor([], "take_home_now")).toEqual(["planning", "production", "supply", "delivery", "selection"]);
  });

  it("use the path's own rule, else the type's", () => {
    const rules = [{ furniturePath: null, areas: ["supply", "delivery"] as const, version: 1 }, { furniturePath: "take_home_now" as const, areas: [] as const, version: 1 }]
      .map((rule) => ({ ...rule, areas: [...rule.areas] }));
    expect(areasFor(rules, "take_home_now")).toEqual([]);
    expect(areasFor(rules, "bespoke")).toEqual(["supply", "delivery"]);
    expect(areasFor(rules, null)).toEqual(["supply", "delivery"]);
  });

  it("never hide an area that holds a record", () => {
    expect(shownAreas(["delivery"], { production: true })).toEqual({ planning: false, production: true, supply: false, delivery: true, selection: false });
  });

  it("are parsed one rule per path, known areas only", () => {
    expect(parseWonAreas([{ furniturePath: null, areas: ["delivery", "planning"] }])).toEqual([{ furniturePath: null, areas: ["planning", "delivery"] }]);
    expect(parseWonAreas([{ furniturePath: null, areas: ["design"] }])).toBe("Choose known areas");
    expect(parseWonAreas([{ furniturePath: "rocket", areas: [] }])).toBe("Choose a furniture path");
    expect(parseWonAreas([{ furniturePath: null, areas: [] }, { furniturePath: "", areas: [] }])).toBe("One rule per path");
  });

  it("start a furniture flow on the kit's paths until the firm sets its own: A ends at handover, E uses every area", () => {
    const kit = effectiveWonAreas([], true);
    expect(areasFor(kit, "take_home_now")).toEqual([]);
    expect(areasFor(kit, "in_stock_delivery")).toEqual(["delivery"]);
    expect(areasFor(kit, "supplier_order")).toEqual(["supply", "delivery"]);
    expect(areasFor(kit, "core_collection_factory")).toEqual(["production", "supply", "delivery"]);
    expect(areasFor(kit, "bespoke")).toEqual(["planning", "production", "supply", "delivery", "selection"]);
    expect(areasFor(kit, null)).toEqual(["planning", "production", "supply", "delivery", "selection"]);
    // The firm's own rules win; other flows keep every area.
    const own = [{ furniturePath: null, areas: ["delivery" as const], version: 2 }];
    expect(effectiveWonAreas(own, true)).toBe(own);
    expect(effectiveWonAreas([], false)).toEqual([]);
    expect(isFurnitureDefinition({ branches: [{ question: "subPath" }] })).toBe(true);
    expect(isFurnitureDefinition({ branches: [] })).toBe(false);
  });
});
