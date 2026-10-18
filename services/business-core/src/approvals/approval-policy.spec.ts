import { describe, expect, it } from "vitest";
import {
  amountChangeResets, DEFAULT_APPROVAL_POLICIES, effectiveSteps, eligibility, escalationStep, isEscalated, isExpired, needsOwner, nextState, selectPolicy,
  validatePolicyInput, type Person, type PolicyStep, type PolicyVersion, type RequestFacts,
} from "./approval-policy";

const step = (position: number, over: Partial<PolicyStep>): PolicyStep => ({ position, approverKind: "permission", permissionCode: null, roleCode: null, userId: null, label: "", ...over });
const FINANCE = step(1, { permissionCode: "commercial.finance.verify", label: "Finance verifies" });
const APPROVER = step(2, { permissionCode: "commercial.deal.approve", label: "Deal File approver" });
const version = (over: Partial<PolicyVersion> = {}): PolicyVersion => ({
  id: "v1", policyId: "p-default", version: 1, name: "Deal File", kind: "deal_file", currency: null, minAmount: null, ownerAboveAmount: null,
  escalateAfterHours: null, waiverAllowed: false, resetTolerancePercent: "0", steps: [FINANCE, APPROVER], ...over,
});
const person = (userId: string, permissions: string[] = [], roles: string[] = []): Person => ({ userId, permissions: new Set(permissions), roles: new Set(roles) });
const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  status: "pending", requesterUserId: "sales", currentStep: 1, stepSince: "2026-10-06T08:00:00.000Z", expiresAt: null,
  steps: [FINANCE, APPROVER], escalateAfterHours: null, waiverAllowed: false, earlier: [], ...over,
});
const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-06T09:00:00.000Z");

describe("E3 policy selection (thresholds, currency)", () => {
  const main = version();
  const large = version({ id: "v-large", policyId: "p-large", name: "Large deals", currency: "AED", minAmount: "500000", ownerAboveAmount: "1000000" });
  const euro = version({ id: "v-eur", policyId: "p-eur", name: "Euro deals", currency: "EUR" });

  it("takes the most specific policy the amount reaches, in its own currency only", () => {
    expect(selectPolicy([main, large, euro], "120000", "AED")?.id).toBe("v1");
    expect(selectPolicy([main, large, euro], "500000", "AED")?.id).toBe("v-large");
    expect(selectPolicy([main, large, euro], "499999.9999", "AED")?.id).toBe("v1");
    // 600,000 EUR is not 600,000 AED: the AED threshold never applies to another currency.
    expect(selectPolicy([main, large, euro], "600000", "EUR")?.id).toBe("v-eur");
    expect(selectPolicy([main, large], "600000", "USD")?.id).toBe("v1");
    expect(selectPolicy([large], "600000", "USD")).toBeNull();
    expect(selectPolicy([main, large], null, null)?.id).toBe("v1");
  });

  it("adds the Owner as the last step at or above the Owner amount, in the policy currency", () => {
    expect(needsOwner(large, "999999.99", "AED")).toBe(false);
    expect(needsOwner(large, "1000000", "AED")).toBe(true);
    expect(needsOwner(large, "1000000", "EUR")).toBe(false);
    const steps = effectiveSteps(large, true);
    expect(steps.map((item) => item.label)).toEqual(["Finance verifies", "Deal File approver", "Owner"]);
    expect(steps[2]).toMatchObject({ position: 3, approverKind: "role", roleCode: "owner" });
  });

  it("ships product defaults that reproduce the rules before the engine (Finance, then a Deal File approver)", () => {
    expect(DEFAULT_APPROVAL_POLICIES.deal_file.steps.map((item) => item.permissionCode)).toEqual(["commercial.finance.verify", "commercial.deal.approve"]);
    expect(DEFAULT_APPROVAL_POLICIES.opportunity_value.steps).toHaveLength(2);
    expect(DEFAULT_APPROVAL_POLICIES.quote_qs.steps.map((item) => item.permissionCode)).toEqual(["commercial.estimate"]);
  });
});

describe("E3 order and decisions", () => {
  const finance = person("finance", ["commercial.finance.verify"]);
  const approver = person("approver", ["commercial.deal.approve"]);

  it("decides only the current step, in order", () => {
    expect(eligibility(facts(), finance, [], NOW)).toMatchObject({ canDecide: true, via: "direct" });
    expect(eligibility(facts(), approver, [], NOW)).toMatchObject({ canDecide: false, reason: "not_yours" });
    expect(eligibility(facts({ currentStep: 2, earlier: [{ decidedBy: "finance", onBehalfOf: null }] }), approver, [], NOW)).toMatchObject({ canDecide: true });
    expect(nextState(facts(), "approve")).toEqual({ status: "pending", currentStep: 2, final: false });
    expect(nextState(facts({ currentStep: 2 }), "approve")).toEqual({ status: "approved", currentStep: 2, final: true });
    expect(nextState(facts(), "return")).toMatchObject({ status: "returned", final: true });
    expect(nextState(facts({ currentStep: 2 }), "reject")).toMatchObject({ status: "rejected", final: true });
  });

  it("a decided request takes no more decisions", () => {
    expect(eligibility(facts({ status: "approved" }), finance, [], NOW)).toMatchObject({ canDecide: false, reason: "decided" });
  });
});

describe("E3-2 separation of duties", () => {
  const both = person("sales", ["commercial.finance.verify", "commercial.deal.approve"]);
  const financeAndApprover = person("fatima", ["commercial.finance.verify", "commercial.deal.approve"]);

  it("the requester never decides their own request", () => {
    expect(eligibility(facts(), both, [], NOW)).toMatchObject({ canDecide: false, reason: "own" });
  });

  it("whoever decided an earlier step (or was covered for in it) doesn't decide a later one", () => {
    const after = facts({ currentStep: 2, earlier: [{ decidedBy: "fatima", onBehalfOf: null }] });
    expect(eligibility(after, financeAndApprover, [], NOW)).toMatchObject({ canDecide: false, reason: "earlier_step" });
    const covered = facts({ currentStep: 2, earlier: [{ decidedBy: "cover", onBehalfOf: "fatima" }] });
    expect(eligibility(covered, financeAndApprover, [], NOW)).toMatchObject({ canDecide: false, reason: "earlier_step" });
  });

  it("a recorded waiver lets the requester decide only where the policy allows it", () => {
    expect(eligibility(facts({ waiverAllowed: true }), both, [], NOW)).toMatchObject({ canDecide: true, via: "waiver" });
    expect(eligibility(facts({ waiverAllowed: true }), person("sales"), [], NOW)).toMatchObject({ canDecide: false });
  });

  it("a step that names only the requester passes to the next approver at once", () => {
    const named = facts({ steps: [step(1, { approverKind: "person", userId: "sales" }), APPROVER] });
    expect(isEscalated(named, NOW)).toBe(true);
    expect(eligibility(named, person("approver", ["commercial.deal.approve"]), [], NOW)).toMatchObject({ canDecide: true, via: "escalation" });
  });
});

describe("E3-1 away: delegation and escalation", () => {
  const away = person("finance", ["commercial.finance.verify"]);
  const cover = person("cover");

  it("a delegate decides for an approver who is away, and the decision records whom it was for", () => {
    expect(eligibility(facts(), cover, [away], NOW)).toEqual({ canDecide: true, via: "delegate", onBehalfOf: "finance", reason: null });
    // Covering for the requester gives no right: separation of duties holds for the person covered for.
    expect(eligibility(facts(), cover, [person("sales", ["commercial.finance.verify"])], NOW)).toMatchObject({ canDecide: false });
  });

  it("after the escalation hours the next step's approvers decide; past the last step, the Owner", () => {
    const waiting = facts({ escalateAfterHours: 24, stepSince: "2026-10-05T08:00:00.000Z" });
    expect(isEscalated(waiting, at("2026-10-06T07:59:59.000Z"))).toBe(false);
    expect(isEscalated(waiting, at("2026-10-06T08:00:00.000Z"))).toBe(true);
    const approver = person("approver", ["commercial.deal.approve"]);
    expect(eligibility(waiting, approver, [], at("2026-10-06T07:00:00.000Z"))).toMatchObject({ canDecide: false });
    expect(eligibility(waiting, approver, [], at("2026-10-06T09:00:00.000Z"))).toMatchObject({ canDecide: true, via: "escalation" });
    const last = facts({ currentStep: 2, escalateAfterHours: 24, stepSince: "2026-10-05T08:00:00.000Z", earlier: [{ decidedBy: "finance", onBehalfOf: null }] });
    expect(escalationStep(last)).toMatchObject({ approverKind: "role", roleCode: "owner" });
    expect(eligibility(last, person("owner", [], ["owner"]), [], NOW)).toMatchObject({ canDecide: true, via: "escalation" });
    // Without an escalation time nothing escalates.
    expect(isEscalated(facts({ stepSince: "2020-01-01T00:00:00.000Z" }), NOW)).toBe(false);
  });
});

describe("E3-3 an amount change after approval", () => {
  const before = { amount: "100000", currency: "AED", policyId: "p", ownerStep: false };

  it("resets when it moves the request under another policy, adds the Owner, or changes currency", () => {
    expect(amountChangeResets({ before, after: { ...before, policyId: "p-large" }, tolerancePercent: "50" })).toBe(true);
    expect(amountChangeResets({ before, after: { ...before, ownerStep: true }, tolerancePercent: "50" })).toBe(true);
    expect(amountChangeResets({ before, after: { ...before, currency: "EUR" }, tolerancePercent: "50" })).toBe(true);
  });

  it("within the tolerance the approvals stand; beyond it they reset; the default tolerance (0) resets on any change", () => {
    expect(amountChangeResets({ before, after: { ...before, amount: "105000" }, tolerancePercent: "5" })).toBe(false);
    expect(amountChangeResets({ before, after: { ...before, amount: "105000.01" }, tolerancePercent: "5" })).toBe(true);
    expect(amountChangeResets({ before, after: { ...before, amount: "100000.01" }, tolerancePercent: "0" })).toBe(true);
    expect(amountChangeResets({ before, after: { ...before }, tolerancePercent: "0" })).toBe(false);
  });
});

describe("E3-4 policy versions", () => {
  it("a request reads the steps of the version it was opened under, not the policy's latest", () => {
    const original = version({ id: "v1", version: 1 });
    const edited = version({ id: "v2", version: 2, steps: [FINANCE, APPROVER, step(3, { approverKind: "role", roleCode: "owner", label: "Owner" })] });
    expect(effectiveSteps(original, false)).toHaveLength(2);
    expect(effectiveSteps(edited, false)).toHaveLength(3);
    // The waiting request (opened under v1) is approved at step 2; under v2 it would still wait for the Owner.
    expect(nextState({ currentStep: 2, steps: effectiveSteps(original, false) }, "approve").status).toBe("approved");
    expect(nextState({ currentStep: 2, steps: effectiveSteps(edited, false) }, "approve").status).toBe("pending");
  });
});

describe("E3-5 expiry", () => {
  it("an expired request can't be approved", () => {
    expect(isExpired(facts({ expiresAt: "2026-10-06T08:59:59.000Z" }), NOW)).toBe(true);
    expect(isExpired(facts({ expiresAt: "2026-10-06T09:00:01.000Z" }), NOW)).toBe(false);
    expect(isExpired(facts(), NOW)).toBe(false);
  });
});

describe("policy validation", () => {
  const steps = [{ approverKind: "permission", permissionCode: "commercial.finance.verify" }, { approverKind: "role", roleCode: "owner" }];

  it("accepts a well-formed policy and names the first problem otherwise", () => {
    expect(validatePolicyInput("deal_file", { name: "Large deals", currency: "aed", minAmount: "500000", ownerAboveAmount: "1000000", escalateAfterHours: 24, steps }))
      .toMatchObject({ currency: "AED", minAmount: "500000", ownerAboveAmount: "1000000", escalateAfterHours: 24, waiverAllowed: false, resetTolerancePercent: "0" });
    expect(() => validatePolicyInput("deal_file", { name: "x", minAmount: "500000", steps })).toThrow(/currency/);
    expect(() => validatePolicyInput("deal_file", { name: "x", currency: "AED", minAmount: "500000", ownerAboveAmount: "100", steps })).toThrow(/Owner amount/);
    expect(() => validatePolicyInput("deal_file", { name: "x", escalateAfterHours: 0, steps })).toThrow(/Escalate/);
    expect(() => validatePolicyInput("deal_file", { name: "x", steps: [steps[1]] })).toThrow(/Finance verifies first/);
    expect(() => validatePolicyInput("refund", { name: "x", steps: [steps[1], steps[1]] })).toThrow(/once/);
    expect(() => validatePolicyInput("refund", { name: "x", steps: [] })).toThrow(/1 to 6/);
    expect(() => validatePolicyInput("refund", { name: "x", minAmount: 12.5, currency: "AED", steps: [steps[1]] })).not.toThrow();
  });
});
