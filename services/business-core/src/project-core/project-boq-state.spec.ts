import { describe, expect, it } from "vitest";
import { BOQ_ACTIONS, BOQ_STATUSES, boqActionsFor, boqTechnicalRoleOf, boqTransition, canActOnBoq, type BoqStatus } from "./project-boq-state";

const all = { manager: true, technical: true, qs: true };

describe("project BOQ lifecycle (PLM-167 / PLM-168)", () => {
  it("goes draft → technical_verified → qs_approved → locked, one step at a time", () => {
    expect(boqTransition("draft", "verify")).toBe("technical_verified");
    expect(boqTransition("technical_verified", "qs_approve")).toBe("qs_approved");
    expect(boqTransition("qs_approved", "lock")).toBe("locked");
  });

  it("never lets the QS approve a BOQ the technical team hasn't verified", () => {
    expect(() => boqTransition("draft", "qs_approve")).toThrow(/technical team verifies the BOQ before/);
    expect(() => boqTransition("qs_approved", "qs_approve")).toThrow(/already approved/);
    expect(() => boqTransition("locked", "qs_approve")).toThrow(/locked/);
  });

  it("locks only an approved BOQ, verifies only a draft", () => {
    expect(() => boqTransition("draft", "lock")).toThrow(/QS approves the BOQ before/);
    expect(() => boqTransition("technical_verified", "lock")).toThrow(/QS approves/);
    expect(() => boqTransition("locked", "lock")).toThrow(/already locked/);
    expect(() => boqTransition("technical_verified", "verify")).toThrow(/already verified/);
    expect(() => boqTransition("qs_approved", "verify")).toThrow(/Return it to draft/);
  });

  it("returns any step to draft except a draft", () => {
    for (const status of ["technical_verified", "qs_approved", "locked"] as BoqStatus[]) expect(boqTransition(status, "return")).toBe("draft");
    expect(() => boqTransition("draft", "return")).toThrow(/already a draft/);
  });

  it("offers each status its actions", () => {
    expect(boqActionsFor("draft")).toEqual(["verify"]);
    expect(boqActionsFor("technical_verified")).toEqual(["qs_approve", "return"]);
    expect(boqActionsFor("qs_approved")).toEqual(["return", "lock"]);
    expect(boqActionsFor("locked")).toEqual(["return"]);
    expect(BOQ_STATUSES.flatMap((status) => boqActionsFor(status)).every((action) => BOQ_ACTIONS.includes(action))).toBe(true);
  });

  it("the technical team or the manager verifies, only the QS approves, only the manager locks, anyone involved returns", () => {
    expect(canActOnBoq("verify", { manager: false, technical: true, qs: false })).toBe(true);
    expect(canActOnBoq("verify", { manager: true, technical: false, qs: false })).toBe(true);
    expect(canActOnBoq("verify", { manager: false, technical: false, qs: true })).toBe(false);
    expect(canActOnBoq("qs_approve", { manager: true, technical: true, qs: false })).toBe(false);
    expect(canActOnBoq("qs_approve", { manager: false, technical: false, qs: true })).toBe(true);
    expect(canActOnBoq("lock", { manager: false, technical: true, qs: true })).toBe(false);
    expect(canActOnBoq("lock", { manager: true, technical: false, qs: false })).toBe(true);
    expect(canActOnBoq("return", { manager: false, technical: false, qs: true })).toBe(true);
    expect(canActOnBoq("return", { manager: false, technical: false, qs: false })).toBe(false);
    expect(BOQ_ACTIONS.every((action) => canActOnBoq(action, all))).toBe(true);
  });

  it("the role that verifies the BOQ is the firm's choice when it has it, else the technical designer, else nobody", () => {
    const roles = [{ key: "project_manager" }, { key: "technical_designer" }, { key: "draftsman" }];
    expect(boqTechnicalRoleOf({ boqTechnicalRole: "draftsman", roles })).toBe("draftsman");
    expect(boqTechnicalRoleOf({ boqTechnicalRole: "removed_role", roles })).toBe("technical_designer");
    expect(boqTechnicalRoleOf({ boqTechnicalRole: null, roles })).toBe("technical_designer");
    expect(boqTechnicalRoleOf({ boqTechnicalRole: null, roles: [{ key: "project_manager" }] })).toBeNull();
  });
});
