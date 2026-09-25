import { describe, expect, it } from "vitest";
import { allowedCasePath } from "./api-path";

const caseId = "4700f7ad-4c63-4f4b-8a03-1b2ef3969a4d";
const baselineId = "6a708af2-988e-4bb8-a668-bae951c03fd4";

describe("pre-execution browser gateway", () => {
  it("allows scoped folder reviews without permitting arbitrary commands", () => {
    for (const action of ["reviewer", "approve"]) {
      expect(allowedCasePath([caseId, "design-folders", baselineId, action], "POST")).toBe(true);
      expect(allowedCasePath([caseId, "design-folders", baselineId, action], "GET")).toBe(false);
      expect(allowedCasePath([caseId, "design-folders", "invalid", action], "POST")).toBe(false);
    }
    expect(allowedCasePath([caseId, "design-folders", baselineId, "delete"], "POST")).toBe(false);
  });
  it("allows only the scoped definition and readiness commands", () => {
    expect(allowedCasePath([caseId, "readiness"], "GET")).toBe(true);
    expect(allowedCasePath([caseId, "definition-baselines"], "GET")).toBe(true);
    expect(allowedCasePath([caseId, "definition-baselines"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "definition-baselines", baselineId, "decisions"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "definition-baselines", "not-an-id", "decisions"], "POST")).toBe(false);
    expect(allowedCasePath([caseId, "definition-baselines", baselineId, "decisions"], "GET")).toBe(false);
    expect(allowedCasePath([caseId, "readiness"], "POST")).toBe(false);
  });
});
