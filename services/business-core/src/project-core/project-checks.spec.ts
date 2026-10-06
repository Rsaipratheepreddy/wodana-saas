import { describe, expect, it } from "vitest";
import { checkPasses, type CheckFacts } from "./project-checks";

const facts = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  filledRoles: new Set(), confirmed: new Set(), productionPaid: false, materialsSignedOff: false, everythingOrdered: false, everythingMade: false,
  openSnags: 0, openCriticalSnags: 0, handedOver: false, ...over,
});

describe("role named check", () => {
  const check = { key: "installer", kind: "role_assigned" as const, role: "installation_lead" };
  it("passes when someone holds the role, or the role is marked not applicable on the project (PLM-100)", () => {
    expect(checkPasses(check, facts())).toBe(false);
    expect(checkPasses(check, facts({ filledRoles: new Set(["installation_lead"]) }))).toBe(true);
    expect(checkPasses(check, facts({ notApplicableRoles: new Set(["installation_lead"]) }))).toBe(true);
    expect(checkPasses(check, facts({ notApplicableRoles: new Set(["designer"]) }))).toBe(false);
  });
  it("never counts the project manager as not applicable", () => {
    expect(checkPasses({ key: "lead", kind: "lead_assigned" }, facts({ notApplicableRoles: new Set(["project_manager"]) }))).toBe(false);
  });
});
