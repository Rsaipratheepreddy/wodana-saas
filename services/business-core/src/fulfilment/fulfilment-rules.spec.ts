import { describe, expect, it } from "vitest";
import { FURNITURE_RULES, NO_RULE, parseRules, ruleFor, type FulfilmentRule } from "./fulfilment-rules";

const rules = FURNITURE_RULES.map((rule) => ({ ...rule, version: 1 })) as FulfilmentRule[];

describe("fulfilment rules per path (PLM-083/125/126)", () => {
  it("defaults the furniture paths from the Enquiry Types Flow table", () => {
    expect(ruleFor(rules, "take_home_now")).toMatchObject({ boqRequired: false, reserveOn: "quote_accepted", deductOn: "won", leadMinDays: 0, leadMaxDays: 0 });
    expect(ruleFor(rules, "in_stock_delivery")).toMatchObject({ reserveOn: "quote_accepted", deductOn: "won", leadMinDays: 3, leadMaxDays: 4 });
    expect(ruleFor(rules, "supplier_order")).toMatchObject({ reserveOn: "supplier_received", deductOn: "fulfilled", leadFromCatalogue: true });
    expect(ruleFor(rules, "core_collection_factory")).toMatchObject({ reserveOn: "production_booked", deductOn: "production_started", leadMinDays: null, leadFromCatalogue: true });
    expect(ruleFor(rules, "bespoke")).toMatchObject({ boqRequired: true, leadMinDays: 20, leadMaxDays: 30, leadFrom: "drawing_approved" });
  });

  it("falls back to the type's rule, then to nothing", () => {
    expect(ruleFor(rules, null)).toMatchObject({ boqRequired: false, reserveOn: "none", deductOn: "none" });
    expect(ruleFor(rules.filter((rule) => rule.furniturePath !== "bespoke"), "bespoke")).toMatchObject({ boqRequired: false, reserveOn: "none" });
    expect(ruleFor([], "take_home_now")).toEqual(NO_RULE);
  });

  it("parses an editor's save and refuses what can't be right", () => {
    expect(parseRules([{ furniturePath: null, boqRequired: null }, { furniturePath: "bespoke", boqRequired: true, reserveOn: "production_booked", deductOn: "production_started",
      leadMinDays: 20, leadMaxDays: 30, leadFrom: "drawing_approved" }])).toEqual([
      { furniturePath: null, boqRequired: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null },
      { furniturePath: "bespoke", boqRequired: true, reserveOn: "production_booked", deductOn: "production_started", leadMinDays: 20, leadMaxDays: 30, leadFrom: "drawing_approved", leadFromCatalogue: false,
        takeFromLocationId: null },
    ]);
    expect(parseRules([{ furniturePath: "garden" }])).toBe("Choose a furniture path");
    expect(parseRules([{ reserveOn: "whenever" }])).toBe("Choose when stock is held and taken out");
    expect(parseRules([{ leadMinDays: 5, leadMaxDays: 3 }])).toBe("The lead time's first day comes before its last");
    expect(parseRules([{ leadMinDays: 5 }])).toBe("Give the lead time from and to");
    expect(parseRules([{ leadMinDays: 1.5, leadMaxDays: 2 }])).toBe("Lead times are whole working days, up to 365");
    expect(parseRules([{ boqRequired: "yes" }])).toBe("Say whether a BOQ is needed");
    expect(parseRules([{ takeFromLocationId: "showroom" }])).toBe("Choose a place stock is kept");
    expect(parseRules([{}, { furniturePath: "" }])).toBe("One rule per path");
    expect(parseRules("all")).toBe("Set the rules per path");
  });
});
