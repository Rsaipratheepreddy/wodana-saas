import { describe, expect, it } from "vitest";
import { groupRequirements, nowPlan, requirementAction, stepForRequirement, type FunnelStep } from "./now-step";
import type { OpportunityFlowView } from "./opportunity-flow";

const view = (overrides: Partial<OpportunityFlowView> = {}): OpportunityFlowView => ({
  flow: "design", steps: [], done: 0, total: 4, next: { stageId: "s2", name: "Qualified", step: "qualified" }, missing: [], toWon: [],
  negotiationOptional: false, enquiryType: null, furniture: null, clientApproval: null, quotationExists: false, paymentVerified: false, proofs: [], ...overrides,
});
const funnel = (states: Partial<Record<FunnelStep["key"], FunnelStep["state"]>>): FunnelStep[] =>
  (["enquiry", "discovery", "intro", "design", "quote", "deal"] as const).map((key) => ({ key, state: states[key] ?? "upcoming", detail: null, at: null }));

describe("now step mapping (F1)", () => {
  it("names every requirement the gates send as a verb with one action", () => {
    expect(stepForRequirement("introMeeting")).toMatchObject({ title: "Book the intro meeting", short: "Book intro", target: "intro" });
    expect(stepForRequirement("furniturePath")).toMatchObject({ title: "Choose how it's supplied", target: "furniture" });
    expect(stepForRequirement("feasibility").target).toBe("furniture");
    expect(stepForRequirement("paymentProof")).toMatchObject({ title: "Attach payment proof", target: "proof" });
    expect(stepForRequirement("quotation").target).toBe("quote");
    expect(stepForRequirement("enquiryType").target).toBe("enquiry");
    expect(stepForRequirement("clientType").target).toBe("enquiry");
    for (const key of ["owner", "nextAction", "amount", "expectedCloseAt", "stakeholders"]) expect(requirementAction(key).target).toBe("edit");
    // Property and discovery facts, known or not, are one form.
    for (const key of ["clientEmail", "propertyLocation", "floorPlanOrArea", "discovery:area", "discovery:question:budget", "somethingNew"]) expect(stepForRequirement(key).title).toBe("Fill in the property details");
  });

  it("groups the property facts into one step and keeps the server's order", () => {
    const steps = groupRequirements([{ key: "clientEmail", label: "Client email" }, { key: "introMeeting", label: "Intro" }, { key: "propertyLocation", label: "Property location" }]);
    expect(steps.map((step) => step.id)).toEqual(["details", "introMeeting"]);
    expect(steps[0].fields).toEqual(["Client email", "Property location"]);
    expect(groupRequirements(undefined)).toEqual([]);
  });

  it("puts the first missing step now, the others under the column, and the next two after", () => {
    const plan = nowPlan({ status: "open", flow: view({
      missing: [{ key: "clientEmail", label: "Client email" }, { key: "floorPlanOrArea", label: "Floor plan or area" }, { key: "enquiryType", label: "Enquiry type chosen" }],
      toWon: [{ key: "clientEmail", label: "Client email" }, { key: "introMeeting", label: "Intro meeting completed" }, { key: "paymentProof", label: "Payment proof attached" }],
    }) });
    expect(plan.now).toMatchObject({ id: "details", target: "discovery" });
    expect(plan.why).toEqual({ key: "Needed to move to {stage}", values: { stage: "Qualified" } });
    expect(plan.more.map((step) => step.id)).toEqual(["enquiryType"]);
    expect(plan.column).toBe("Qualified");
    expect(plan.then.map((step) => step.id)).toEqual(["advance", "introMeeting"]);
  });

  it("moves on when the next column needs nothing, and Won asks for the proof", () => {
    const ready = nowPlan({ status: "open", flow: view({ toWon: [{ key: "paymentProof", label: "Payment proof attached" }] }) });
    expect(ready.now).toMatchObject({ target: "advance", values: { stage: "Qualified" } });
    expect(ready.then.map((step) => step.id)).toEqual(["paymentProof"]);
    const toWon = nowPlan({ status: "open", flow: view({ next: { stageId: "w", name: "Won", step: "won" }, missing: [{ key: "paymentProof", label: "Payment proof attached" }], toWon: [{ key: "paymentProof", label: "Payment proof attached" }] }) });
    expect(toWon.now).toMatchObject({ target: "proof" });
    expect(toWon.then).toEqual([]);
    // A payment Finance already verified is the proof: Won asks only for the reason.
    expect(nowPlan({ status: "open", flow: view({ next: { stageId: "w", name: "Won", step: "won" } }) }).now?.target).toBe("win");
    expect(nowPlan({ status: "open", flow: view({ next: null }) }).now).toBeNull();
    expect(nowPlan({ status: "open", flow: null }).now).toBeNull();
  });

  it("after Won the work continues in Planning; a lost one can be reopened", () => {
    expect(nowPlan({ status: "won", flow: view(), funnel: funnel({}), caseId: null }).now).toMatchObject({ id: "planning", target: "planning" });
    const designing = nowPlan({ status: "won", flow: view(), funnel: funnel({ design: "active" }), caseId: "case-1" });
    expect(designing.now).toMatchObject({ id: "design", section: "designs" });
    expect(designing.then.map((step) => step.id)).toEqual(["quote", "deal"]);
    // Furniture has no design step.
    expect(nowPlan({ status: "won", flow: view({ flow: "furniture" }), funnel: funnel({ quote: "done" }), caseId: "case-1" }).now).toMatchObject({ id: "deal", section: "approvals" });
    expect(nowPlan({ status: "won", flow: view(), funnel: funnel({ design: "done", quote: "done", deal: "done" }), caseId: "case-1" }).now).toMatchObject({ id: "planning", section: "overview" });
    expect(nowPlan({ status: "lost", flow: view() }).now).toMatchObject({ target: "reopen" });
  });
});
