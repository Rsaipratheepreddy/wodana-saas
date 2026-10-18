import { describe, expect, it } from "vitest";
import { normalizeCommissionLines } from "../commercial/deal-submission";
import { commissionVersion, KIT_COMMISSION_TYPES, normaliseCommissionTypes } from "./commission-types";

describe("the firm's commission types (§0.3 P3)", () => {
  it("keeps one to eight named types, gives a new one a code from its name and refuses a repeat", () => {
    expect(normaliseCommissionTypes([{ code: "sales", label: "Sales" }, { label: "Project management fee" }])).toEqual([
      { code: "sales", label: "Sales" }, { code: "project_management_fee", label: "Project management fee" }]);
    expect(() => normaliseCommissionTypes([])).toThrow("one to eight");
    expect(() => normaliseCommissionTypes([{ label: "" }])).toThrow("Name commission type 1");
    expect(() => normaliseCommissionTypes([{ label: "Referral" }, { label: "referral" }])).toThrow("twice");
  });

  it("checks a deal's commission lines against the firm's list (the kit's three when it has none)", () => {
    const line = (type: string) => [{ recipientName: "Agent", type, basis: "amount", value: 100 }];
    expect(normalizeCommissionLines(line("referral"), 1000, "AED")).toHaveLength(1);
    expect(() => normalizeCommissionLines(line("project_management_fee"), 1000, "AED")).toThrow("Choose the type for commission 1.");
    expect(normalizeCommissionLines(line("project_management_fee"), 1000, "AED", ["sales", "project_management_fee"])[0].type).toBe("project_management_fee");
  });

  it("versions the list by its content", () => {
    expect(commissionVersion(KIT_COMMISSION_TYPES)).toBe(commissionVersion([...KIT_COMMISSION_TYPES]));
    expect(commissionVersion(KIT_COMMISSION_TYPES)).not.toBe(commissionVersion(KIT_COMMISSION_TYPES.slice(1)));
  });
});
