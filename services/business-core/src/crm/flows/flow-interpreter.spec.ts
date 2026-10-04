import { describe, expect, it } from "vitest";
import { flowChecksum, validateFlowDefinition, type FlowDefinition } from "./flow-definition";
import { flowProgress, moveBlockers, nextColumnPlan, requirementsUpTo, resolveLine, type CheckFacts } from "./flow-interpreter";
import { STARTER_FLOWS, starterFlow } from "./starter-flows";

/** Nothing done yet. */
const empty = (): CheckFacts => ({
  enquiryTypeResolved: true, clientTypeResolved: false, clientType: null, clientEmail: false, propertyLocation: false, floorPlanOrArea: false, budgetBand: null,
  contactLogged: false, introCompleted: false, discoveryMissing: [], furniturePath: null, feasibilityConfirmed: false, packageCode: null, siteVisitRecorded: false,
  quotationExists: false, qsApproved: false, quoteSent: false, quoteAccepted: false, clientApprovedOnSpot: false, paymentProof: false, paymentVerified: false,
  dealApproved: false, designStagesDone: [], materialListSignedOff: false,
});
/** Everything the r30 gates read is done. */
const complete = (): CheckFacts => ({
  ...empty(), clientTypeResolved: true, clientType: "end_user", clientEmail: true, propertyLocation: true, floorPlanOrArea: true, introCompleted: true,
  furniturePath: "take_home_now", quotationExists: true, paymentProof: true,
});
const def = (code: string) => STARTER_FLOWS[code].definition;
const COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];
const STAGES = [...COLUMNS, "lost"].map((code, index) => ({ code, position: index + 1 }));
const at = (code: string) => STAGES.find((stage) => stage.code === code)!;
const move = (flow: string, facts: CheckFacts, from: string, to: string, targetStatus = to === "won" ? "won" : "open") =>
  moveBlockers({ definition: def(flow), facts, from: at(from), to: at(to), firstPosition: 1, stages: STAGES, targetStatus }).map((item) => item.key);
/** What one column itself needs (not the columns before it). */
const columnNeeds = (flow: string, column: string, facts: CheckFacts) =>
  requirementsUpTo(def(flow), facts, COLUMNS.indexOf(column)).filter((item) => item.column === column).map((item) => item.key);

describe("flow interpreter on the starter flows (plan §5a)", () => {
  const table: Array<[string, string, string[]]> = [
    ["design", "qualified", ["clientEmail", "propertyLocation", "floorPlanOrArea"]],
    ["design", "qualification", ["introMeeting", "clientType"]],
    ["design", "proposal", []],
    ["design", "negotiation", []],
    ["design", "won", ["paymentProof"]],
    ["fit_out", "qualified", ["clientEmail", "propertyLocation", "floorPlanOrArea"]],
    ["fit_out", "qualification", ["introMeeting", "clientType"]],
    ["fit_out", "won", ["paymentProof"]],
    ["furniture", "qualified", []],
    ["furniture", "qualification", ["furniturePath", "clientType"]],
    ["furniture", "proposal", ["quotation"]],
    ["furniture", "negotiation", []],
    ["furniture", "won", ["paymentProof"]],
    ["basic", "qualified", []],
    ["basic", "qualification", []],
    ["basic", "won", ["paymentProof"]],
  ];
  it.each(table)("%s · %s needs %j when nothing is done, nothing once everything is", (flow, column, expected) => {
    expect(columnNeeds(flow, column, empty())).toEqual(expected);
    expect(columnNeeds(flow, column, complete())).toEqual([]);
  });

  it("keeps a 'not sure yet' enquiry in the first column whatever the flow (PLM-007)", () => {
    for (const flow of ["design", "fit_out", "furniture", "basic"]) {
      const facts = { ...complete(), enquiryTypeResolved: false };
      expect(move(flow, facts, "qualified", "qualification")).toContain("enquiryType");
      expect(move(flow, facts, "qualified", "won")).toContain("enquiryType");
    }
  });

  it("asks for discovery items an earlier step does not already ask for", () => {
    const facts = { ...complete(), floorPlanOrArea: false, discoveryMissing: [
      { key: "floorPlan", label: "Floor plan" }, { key: "area", label: "Area" }, { key: "clientEmail", label: "Client email" }, { key: "question:style", label: "Style" },
    ] };
    expect(columnNeeds("design", "proposal", facts)).toEqual(["discovery:question:style"]);
    expect(columnNeeds("design", "proposal", { ...facts, floorPlanOrArea: true })).toEqual(["discovery:floorPlan", "discovery:area", "discovery:question:style"]);
  });

  it("branches furniture on the sub-path: A–D auto-qualify, bespoke needs feasibility", () => {
    const facts = { ...empty(), clientTypeResolved: true, clientType: "end_user", furniturePath: "bespoke" as const };
    expect(columnNeeds("furniture", "qualification", facts)).toEqual(["feasibility"]);
    expect(resolveLine(def("furniture"), facts).map((step) => step.key)).toContain("feasibility");
    expect(columnNeeds("furniture", "qualification", { ...facts, feasibilityConfirmed: true })).toEqual([]);
    for (const path of ["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory"] as const)
      expect(columnNeeds("furniture", "qualification", { ...facts, furniturePath: path })).toEqual([]);
  });

  it("checks every column a jump passes and lets furniture skip Negotiation", () => {
    expect(move("furniture", empty(), "qualified", "won")).toEqual(["furniturePath", "clientType", "quotation", "paymentProof"]);
    expect(move("furniture", { ...complete(), paymentProof: false }, "proposal", "won")).toEqual(["paymentProof"]);
    expect(nextColumnPlan({ definition: def("furniture"), facts: complete(), current: 2, status: "open" })).toMatchObject({ next: 4, skippable: true, missing: [] });
    expect(nextColumnPlan({ definition: def("design"), facts: complete(), current: 2, status: "open" })).toMatchObject({ next: 3, skippable: false });
  });

  it("always allows moving back and losing (engine rule 1)", () => {
    expect(move("design", empty(), "proposal", "qualified")).toEqual([]);
    expect(move("design", empty(), "proposal", "lost", "lost")).toEqual([]);
  });

  it("computes the current step from the records, with who and when", () => {
    const facts = { ...complete(), quotationExists: false, paymentProof: false, evidence: { intro_meeting_completed: { at: "2026-10-01T09:00:00.000Z", by: "Lina" } } };
    const { line, current } = flowProgress(def("design"), facts);
    expect(line.find((step) => step.key === "intro_meeting")).toMatchObject({ state: "done", doneAt: "2026-10-01T09:00:00.000Z", doneBy: "Lina" });
    // Optional steps not done yet still come first on the line; nothing later is done.
    expect(current?.key).toBe("package");
    const later = flowProgress(def("design"), { ...facts, quoteAccepted: true });
    // A later step is done, so the optional steps before it are passed over.
    expect(later.line.find((step) => step.key === "package")?.state).toBe("skipped");
    expect(later.current?.key).toBe("payment_proof");
    expect(flowProgress(def("basic"), { ...complete() }).current).toBeNull();
  });

  it("falls back to the basic starter for an unknown code", () => {
    expect(starterFlow("unknown").code).toBe("basic");
    expect(starterFlow("design").code).toBe("design");
  });
});

describe("flow validator (the publisher's rules)", () => {
  const base = (): FlowDefinition => structuredClone(def("furniture"));
  const errors = (definition: unknown) => {
    const result = validateFlowDefinition(definition);
    return result.ok ? [] : result.errors.map((error) => `${error.path}: ${error.message}`);
  };

  it("accepts every starter and fingerprints it stably", () => {
    for (const code of Object.keys(STARTER_FLOWS)) expect(errors(def(code))).toEqual([]);
    const shuffled = Object.fromEntries(Object.entries(def("design")).reverse()) as FlowDefinition;
    expect(flowChecksum(shuffled)).toBe(flowChecksum(def("design")));
  });

  it("refuses a flow where Won is not reached by the payment proof (PLM-122)", () => {
    const definition = base();
    definition.steps = definition.steps.filter((step) => step.key !== "payment_proof");
    expect(errors(definition).join()).toMatch(/payment proof/);
    const optional = base();
    optional.steps.at(-1)!.optional = true;
    expect(errors(optional).join()).toMatch(/required payment proof/);
    const early = base();
    early.steps[0].column = "won";
    expect(errors(early).join()).toMatch(/Only the payment proof step enters Won/);
  });

  it("refuses steps without a role, unknown checks, duplicate keys and unknown properties", () => {
    const definition = base() as unknown as { steps: Array<Record<string, unknown>> };
    definition.steps[1].role = "";
    definition.steps[2].check = "typed_in_rule";
    definition.steps[3].key = definition.steps[0].key;
    definition.steps[0].script = "return true";
    const found = errors(definition).join("\n");
    expect(found).toMatch(/steps\[1\]\.role: Every step has a role/);
    expect(found).toMatch(/steps\[2\]\.check/);
    expect(found).toMatch(/used twice/);
    expect(found).toMatch(/steps\[0\]\.script: Unknown property/);
  });

  it("refuses columns that move backward along any path", () => {
    const definition = base();
    definition.steps[3].column = "qualified";
    expect(errors(definition).join()).toMatch(/Columns only move forward/);
    const branch = base();
    branch.branches[0].answers[4].steps[0].column = "negotiation";
    expect(errors(branch).join()).toMatch(/cannot enter a column after the step its paths rejoin/);
  });

  it("refuses branches that dead-end, rejoin elsewhere, or come before their question", () => {
    const deadEnd = base();
    deadEnd.branches[0].after = "payment_proof";
    expect(errors(deadEnd).join()).toMatch(/dead end/);
    const elsewhere = base();
    elsewhere.branches[0].rejoin = "payment_proof";
    expect(errors(elsewhere).join()).toMatch(/rejoin at the next step/);
    const early = base();
    early.branches[0].after = "enquiry_type";
    early.branches[0].rejoin = "sub_path";
    expect(errors(early).join()).toMatch(/Ask the question in a step before the branch/);
    const noAnswers = base();
    noAnswers.branches[0].answers = [];
    expect(errors(noAnswers).join()).toMatch(/1 to 20 answers/);
    const badPath = base();
    badPath.branches[0].answers[0].value = "teleport";
    expect(errors(badPath).join()).toMatch(/furniture sub-path/);
  });

  it("refuses a details step with no fields and a design stage step with no stage", () => {
    const definition = base();
    definition.steps[0].needs = [];
    definition.steps.splice(1, 0, { key: "renders", name: "Renders done", role: "sales", check: "design_stage_done", column: "qualification" });
    const found = errors(definition).join();
    expect(found).toMatch(/Choose the details this step needs/);
    expect(found).toMatch(/Choose the design stage/);
  });
});
