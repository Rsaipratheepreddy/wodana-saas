import { describe, expect, it } from "vitest";
import { columnOfStep, groupForRequirement, groupRequirements, nextChecklist, nowPlan, requirementAction, stepForRequirement, type FunnelStep } from "./now-step";
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

  it("puts every requirement key in the group whose card and sheet resolve it", () => {
    for (const key of ["floorPlan", "area", "floorPlanOrArea", "spaces", "propertyLocation", "clientEmail", "discovery:area", "discovery:clientEmail", "somethingNew"]) expect(groupForRequirement(key)).toBe("property");
    expect(groupForRequirement("discovery:question:budget")).toBe("questions");
    expect(groupForRequirement("package")).toBe("package");
    expect(groupForRequirement("introMeeting")).toBe("intro");
    expect(groupForRequirement("paymentProof")).toBe("payment");
    for (const key of ["furniturePath", "feasibility", "clientApproval"]) expect(groupForRequirement(key)).toBe("supply");
    for (const key of ["enquiryType", "clientType", "discovery:clientType"]) expect(groupForRequirement(key)).toBe("client");
    for (const key of ["quotation", "qsApproval", "designStage:renders"]) expect(groupForRequirement(key)).toBe("planning");
    expect(columnOfStep("new")).toBe("qualified");
    expect(columnOfStep("qualified")).toBe("qualification");
    expect(columnOfStep("proposal")).toBe("proposal");
  });

  it("lists the next column's needs in line order: done steps of that column and every missing requirement", () => {
    const line = [
      { key: "details", name: "Complete the client details", check: "details_complete", column: "qualified", optional: false, state: "current" as const, doneAt: null, doneBy: null, missing: [{ key: "floorPlanOrArea", label: "Floor plan or area" }] },
      { key: "enquiry_type", name: "Confirm the enquiry type", check: "details_complete", column: "qualification", optional: false, state: "done" as const, doneAt: "2026-10-01T08:00:00.000Z", doneBy: "Sara", missing: [] },
      { key: "intro_meeting", name: "Hold the intro meeting", check: "intro_meeting_completed", column: "qualification", optional: false, state: "upcoming" as const, doneAt: null, doneBy: null, missing: [{ key: "introMeeting", label: "Intro meeting completed" }] },
      { key: "package", name: "Choose the design package", check: "package_chosen", column: "qualification", optional: true, state: "done" as const, doneAt: null, doneBy: null, missing: [] },
      { key: "discovery", name: "Complete discovery", check: "discovery_complete", column: "proposal", optional: false, state: "upcoming" as const, doneAt: null, doneBy: null, missing: [{ key: "discovery:area", label: "Area" }] },
    ];
    const list = nextChecklist(view({ line, missing: [{ key: "floorPlanOrArea", label: "Floor plan or area" }, { key: "introMeeting", label: "Intro meeting completed" }] }), "open")!;
    expect(list).toMatchObject({ column: "Qualified", columnCode: "qualification", why: { key: "{stage} means the brief is clear enough to plan the intro.", values: { stage: "Qualified" } } });
    expect(list.rows.map((row) => [row.id, row.state, row.group, row.action])).toEqual([
      ["floorPlanOrArea", "missing", "property", "Add"],
      ["step:enquiry_type", "done", null, null],
      ["introMeeting", "missing", "intro", "Book"],
    ]);
    expect(list.rows[1]).toMatchObject({ label: "Confirm the enquiry type", doneBy: "Sara" });
    // Without the line (an older response) the missing requirements still list, each with its action.
    const bare = nextChecklist(view({ missing: [{ key: "discovery:floorPlan", label: "Floor plan" }, { key: "discovery:question:budget", label: "Budget" }, { key: "paymentProof", label: "Payment proof attached" }] }), "open")!;
    expect(bare.rows.map((row) => [row.group, row.action, row.target])).toEqual([["property", "Upload", "discovery"], ["questions", "Answer", "discovery"], ["payment", "Attach", "proof"]]);
    // Ready: nothing missing says so; closed or columnless jobs have no checklist.
    expect(nextChecklist(view(), "open")).toMatchObject({ rows: [], why: { key: "Everything for {stage} is in place" } });
    expect(nextChecklist(view(), "won")).toBeNull();
    expect(nextChecklist(view({ next: null }), "open")).toBeNull();
    expect(nextChecklist(view({ next: { stageId: "x", name: "Site survey", step: "site_survey" }, missing: [{ key: "contact", label: "Contact logged" }] }), "open")!.why.key).toBe("Needed to move to {stage}");
  });
});

