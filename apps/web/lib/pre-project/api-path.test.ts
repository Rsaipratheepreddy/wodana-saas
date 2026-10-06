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
  it("passes the design flow, presentation and ledger commands, and nothing else on them (plan §6.7a)", () => {
    const id = baselineId;
    expect(allowedCasePath([caseId, "design-journey", "site-visit", "answers"], "PUT")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "material-selection", "slots"], "GET")).toBe(true);
    for (const action of ["schedule", "confirm", "not-required"]) expect(allowedCasePath([caseId, "design-journey", "material-selection", action], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "stages", "renders", "assign"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "estimate"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-journey", "material-selection", "slots"], "POST")).toBe(false);
    expect(allowedCasePath([caseId, "design-presentations"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-presentations", id, "decision"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-presentations", id, "delete"], "POST")).toBe(false);
    expect(allowedCasePath([caseId, "design-ledger"], "GET")).toBe(true);
    expect(allowedCasePath([caseId, "design-ledger", "catalog"], "GET")).toBe(true);
    expect(allowedCasePath([caseId, "design-ledger", "catalog"], "POST")).toBe(false);
    expect(allowedCasePath([caseId, "design-ledger", "entries"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-ledger", "entries", id, "versions"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-ledger", "entries", id, "versions", id, "decision"], "POST")).toBe(true);
    expect(allowedCasePath([caseId, "design-ledger", "entries", id], "DELETE")).toBe(false);
    expect(allowedCasePath([caseId, "designs", id, "threads", id, "audience"], "POST")).toBe(true);
  });
});
