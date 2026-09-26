import { describe, expect, it } from "vitest";
import { allowedCasePath } from "./api-path";

const caseId = "4700f7ad-4c63-4f4b-8a03-1b2ef3969a4d";
const baselineId = "6a708af2-988e-4bb8-a668-bae951c03fd4";

describe("pre-execution browser gateway", () => {
  it("passes design sign-off and skipping a design stage, nothing else", () => {
    expect(allowedCasePath([caseId, "design-journey", "sign-off"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "stages", "concepts", "skip"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "stages", "approval", "skip"], "POST")).toBe(false);
    expect(allowedCasePath([caseId, "design-journey", "stages", "concepts", "skip"], "GET")).toBe(false);
  });
  it("no longer passes the removed folder review commands", () => {
    for (const action of ["reviewer", "approve", "delete"]) expect(allowedCasePath([caseId, "design-folders", baselineId, action], "POST")).toBe(false);
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
