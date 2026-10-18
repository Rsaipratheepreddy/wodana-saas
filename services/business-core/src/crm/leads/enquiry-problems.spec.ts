import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUIREMENTS, floorPlanReady, isRequirableKey, ProblemList, requiredBy, requirementProblems, rulesByType, storedFloorPlan, throwProblems,
  type EnquiryFacts, type RequirementContext,
} from "./enquiry-problems";

const facts = (change: Partial<EnquiryFacts> = {}): EnquiryFacts => ({
  serviceType: "full_id", email: "a@b.example", area: "Marina", address: "Villa 4", budgetRange: "mid", customerType: "individual", summary: "Kitchen",
  team: new Set(["designer"]), custom: new Set(), customLabels: new Map(), ...change,
});
const context = (rules: RequirementContext["rules"], change: Partial<RequirementContext> = {}): RequirementContext => ({
  rules, hidden: new Set(), hasBudgetRanges: true, hasCustomerTypes: true, hasProjectTypes: true, teamRoles: ["designer"], ...change,
});

describe("one error box for every problem (PLM-092)", () => {
  it("names every problem at once, each with its field, and nothing when there is none", () => {
    const list = new ProblemList().when(true, "displayName", "Enter a customer name").when(false, "mobile", "x").when(true, "email", "Enter a valid email").add("email", "twice");
    expect(list.items).toEqual([{ key: "displayName", label: "Enter a customer name" }, { key: "email", label: "Enter a valid email" }]);
    expect(() => list.throwIfAny()).toThrow(expect.objectContaining({ response: { statusCode: 422, error: "Unprocessable Entity", message: "Enter a customer name. Enter a valid email", missing: list.items } }));
    expect(() => new ProblemList().throwIfAny()).not.toThrow();
  });
  it("opens the message with what the person was doing", () => {
    expect(() => throwProblems([{ key: "email", label: "Enter the client's email" }], "Complete the enquiry before converting"))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ message: "Complete the enquiry before converting: Enter the client's email", missing: [{ key: "email", label: "Enter the client's email" }] }) }));
  });
});

describe("required fields per enquiry type (PLM-096)", () => {
  it("applies a field from its gate on: create < convert < book the intro; never is off", () => {
    expect(requiredBy("create", "convert")).toBe(true);
    expect(requiredBy("convert", "create")).toBe(false);
    expect(requiredBy("convert", "book_intro")).toBe(true);
    expect(requiredBy("book_intro", "convert")).toBe(false);
    expect(requiredBy("never", "book_intro")).toBe(false);
    expect(requiredBy(undefined, "book_intro")).toBe(false);
  });

  it("lists every missing field required at conversion, in a stable order, with the enquiry type first", () => {
    const rules = { email: "convert", area: "convert", address: "create", budgetRange: "convert", "team:designer": "convert" } as const;
    const empty = facts({ serviceType: "not_sure", email: null, area: "", address: " ", budgetRange: null, team: new Set() });
    expect(requirementProblems(empty, context(rules), "convert").map((item) => item.key))
      .toEqual(["serviceType", "email", "area", "address", "budgetRange", "team:designer"]);
    // At creation only what the type requires from the start, and Not sure yet is allowed.
    expect(requirementProblems(empty, context(rules), "create").map((item) => item.key)).toEqual(["address"]);
    expect(requirementProblems(facts(), context(rules), "convert")).toEqual([]);
    // Guide D: "Not sure yet" is an intake answer only.
    expect(requirementProblems(facts({ budgetRange: "not_sure" }), context(rules), "create")).toEqual([]);
    expect(requirementProblems(facts({ budgetRange: "not_sure" }), context(rules), "convert").map((item) => item.key)).toEqual(["budgetRange"]);
  });

  it("never asks for a hidden field, a list the workspace does not keep, or a team role the type does not ask for", () => {
    const rules = { email: "convert", budgetRange: "convert", customerType: "convert", "team:designer": "convert", "team:quantity_surveyor": "convert" } as const;
    const blank = facts({ email: null, budgetRange: null, customerType: null, team: new Set() });
    expect(requirementProblems(blank, context(rules, { hidden: new Set(["email"]), hasBudgetRanges: false, hasCustomerTypes: false, teamRoles: [] }), "convert")).toEqual([]);
  });

  it("asks for the workspace's own fields from conversion on, by their name", () => {
    const key = "cf:00000000-0000-4000-8000-000000000001";
    const withField = facts({ customLabels: new Map([[key, "Plot number"]]) });
    expect(requirementProblems(withField, context({ [key]: "convert" }), "convert")).toEqual([{ key, label: "Fill in Plot number" }]);
    expect(requirementProblems({ ...withField, custom: new Set([key]) }, context({ [key]: "convert" }), "convert")).toEqual([]);
  });

  it("uses today's rules for a type the firm has not configured, and only the stored set once it has", () => {
    const rows = [{ enquiryType: "furniture", fieldKey: "address", requiredAt: "convert" as const, version: 1 }];
    const rules = rulesByType(rows, ["full_id", "furniture", "not_sure"]);
    expect(rules.full_id).toEqual(DEFAULT_REQUIREMENTS);
    expect(rules.full_id).toEqual({ email: "book_intro" });
    expect(rules.furniture).toEqual({ email: "never", address: "convert" });
    expect(rules.not_sure).toEqual({});
  });

  it("accepts only product fields, team roles and the workspace's own fields as keys", () => {
    for (const key of ["email", "area", "address", "budgetRange", "customerType", "summary", "team:designer", "cf:00000000-0000-4000-8000-000000000001"]) expect(isRequirableKey(key)).toBe(true);
    for (const key of ["displayName", "mobile", "emirate", "team:plumber", "cf:x", "internalNotes"]) expect(isRequirableKey(key)).toBe(false);
  });

  it("asks for the floor plan and project type before converting when the firm requires them (§0.3 P0)", () => {
    const rules = { floorPlan: "convert", projectType: "convert", budgetRange: "convert" } as const;
    const blank = facts({ budgetRange: null, projectType: null, floorPlan: null });
    expect(requirementProblems(blank, context(rules), "convert").map((item) => item.key)).toEqual(["budgetRange", "projectType", "floorPlan"]);
    // Each floor plan answer counts only with what it needs: the file, or the size estimate.
    expect(floorPlanReady({ status: "uploaded" })).toBe(false);
    expect(floorPlanReady({ status: "uploaded", assetId: "00000000-0000-4000-8000-000000000002" })).toBe(true);
    expect(floorPlanReady({ status: "not_available", builtUpArea: " " })).toBe(false);
    expect(floorPlanReady({ status: "not_available", builtUpArea: "2–3 bedroom villa" })).toBe(true);
    expect(floorPlanReady({ status: "not_required" })).toBe(true);
    const ready = facts({ projectType: "villa", floorPlan: { status: "not_available", builtUpArea: "4,500 sq ft" } });
    expect(requirementProblems(ready, context(rules), "convert")).toEqual([]);
    // A firm without a project type list is never asked for one; anything else stored is no answer.
    expect(requirementProblems(facts({ projectType: null, floorPlan: { status: "not_required" } }), context(rules, { hasProjectTypes: false }), "convert")).toEqual([]);
    expect(storedFloorPlan({ status: "maybe" })).toBeNull();
    expect(storedFloorPlan({ status: "uploaded", assetId: 7 })).toEqual({ status: "uploaded", assetId: null, builtUpArea: null, plotSize: null });
    expect(storedFloorPlan({ status: "not_available", builtUpArea: "5 BHK", plotSize: "10,000 sq ft" })).toMatchObject({ plotSize: "10,000 sq ft" });
    // Guide D: "Not required" is for a furniture-only enquiry; any other type gives the plan or a size estimate.
    const notNeeded = facts({ projectType: "villa", floorPlan: { status: "not_required" } });
    expect(requirementProblems(notNeeded, context(rules, { furnitureType: true }), "convert")).toEqual([]);
    expect(requirementProblems(notNeeded, context(rules, { furnitureType: false }), "convert").map((item) => item.key)).toEqual(["floorPlan"]);
    expect(isRequirableKey("floorPlan") && isRequirableKey("projectType")).toBe(true);
  });
});
