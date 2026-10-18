import { describe, expect, it } from "vitest";
import { areasFor, parseWonAreas, shownAreas } from "./flow-won-areas";

describe("areas after Won per enquiry-type path (PLM-098)", () => {
  it("default to every area, so a workspace that never set them sees what it saw", () => {
    expect(areasFor([], null)).toEqual(["planning", "production", "supply", "delivery"]);
    expect(areasFor([], "take_home_now")).toEqual(["planning", "production", "supply", "delivery"]);
  });

  it("use the path's own rule, else the type's", () => {
    const rules = [{ furniturePath: null, areas: ["supply", "delivery"] as const, version: 1 }, { furniturePath: "take_home_now" as const, areas: [] as const, version: 1 }]
      .map((rule) => ({ ...rule, areas: [...rule.areas] }));
    expect(areasFor(rules, "take_home_now")).toEqual([]);
    expect(areasFor(rules, "bespoke")).toEqual(["supply", "delivery"]);
    expect(areasFor(rules, null)).toEqual(["supply", "delivery"]);
  });

  it("never hide an area that holds a record", () => {
    expect(shownAreas(["delivery"], { production: true })).toEqual({ planning: false, production: true, supply: false, delivery: true });
  });

  it("are parsed one rule per path, known areas only", () => {
    expect(parseWonAreas([{ furniturePath: null, areas: ["delivery", "planning"] }])).toEqual([{ furniturePath: null, areas: ["planning", "delivery"] }]);
    expect(parseWonAreas([{ furniturePath: null, areas: ["design"] }])).toBe("Choose known areas");
    expect(parseWonAreas([{ furniturePath: "rocket", areas: [] }])).toBe("Choose a furniture path");
    expect(parseWonAreas([{ furniturePath: null, areas: [] }, { furniturePath: "", areas: [] }])).toBe("One rule per path");
  });
});
