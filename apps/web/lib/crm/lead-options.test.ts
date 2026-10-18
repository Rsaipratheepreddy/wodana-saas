import { describe, expect, it } from "vitest";
import { roleVocabularyKeys, sourceAllowedFor, withRoleVocabulary, floorPlanReady } from "./lead-options";

describe("one role vocabulary for sources limited to roles", () => {
  const selfGenerated = { id: "self_generated", label: "Self generated", allowedRoles: ["SALES", "SALES_ADMIN", "OPS_ADMIN"] };

  it("lets the kit's Sales role pick Self Generated, whatever case the source was saved in", () => {
    expect(sourceAllowedFor(selfGenerated, ["sales"])).toBe(true);
    // A team role and its team answer to each other.
    expect(sourceAllowedFor(selfGenerated, ["team_sales"])).toBe(true);
    expect(sourceAllowedFor(selfGenerated, ["Administrator"])).toBe(true);
    expect(sourceAllowedFor(selfGenerated, ["viewer"])).toBe(false);
    expect(sourceAllowedFor({ id: "company", label: "Company" }, [])).toBe(true);
  });

  it("normalises role keys and saved limits", () => {
    expect(roleVocabularyKeys(["Sales", " team_ops_admin "])).toEqual(["ops_admin", "sales", "team_ops_admin", "team_sales"]);
    const options = withRoleVocabulary({ sources: [selfGenerated], channels: {}, enquiryTypes: [], budgetRanges: [], customerTypes: [], emirates: [], areas: {} });
    expect(options?.sources[0].allowedRoles).toEqual(["sales", "sales_admin", "ops_admin"]);
  });

  it("counts a floor plan answer only with what it needs: the file, or the size estimate (§0.3 P0)", () => {
    expect(floorPlanReady(undefined)).toBe(false);
    expect(floorPlanReady({ status: "uploaded" })).toBe(false);
    expect(floorPlanReady({ status: "uploaded", assetId: "a" })).toBe(true);
    expect(floorPlanReady({ status: "not_available", builtUpArea: "  " })).toBe(false);
    expect(floorPlanReady({ status: "not_available", builtUpArea: "3 bedrooms" })).toBe(true);
    expect(floorPlanReady({ status: "not_required" })).toBe(true);
  });
});
