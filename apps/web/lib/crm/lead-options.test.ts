import { describe, expect, it } from "vitest";
import { roleVocabularyKeys, sourceAllowedFor, withRoleVocabulary } from "./lead-options";

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
});
