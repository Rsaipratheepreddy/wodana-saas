import { describe, expect, it } from "vitest";
import type { HostAvailability, WorkCalendar } from "../../booking/booking.domain";
import { canSkipStep, definitionPaths, flowPolicyProblems, validateFlowDefinition, type FlowDefinition, type FlowStepDefinition } from "../flows/flow-definition";
import { flowProgress, requirementsUpTo, type CheckFacts } from "../flows/flow-interpreter";
import { migrationEffect } from "../flows/flow-migration";
import { flowTemplate, FLOW_TEMPLATES } from "../flows/flow-templates";
import { STARTER_FLOWS } from "../flows/starter-flows";
import { jointSlots, siteVisitApplies, visitMinutes } from "./site-visit.domain";

const empty = (): CheckFacts => ({
  enquiryTypeResolved: true, clientTypeResolved: false, clientType: null, clientEmail: false, propertyLocation: false, floorPlanOrArea: false, budgetBand: null,
  contactLogged: false, introCompleted: false, discoveryMissing: [], furniturePath: null, feasibilityConfirmed: false, packageCode: null, siteVisitRecorded: false,
  quotationExists: false, qsApproved: false, quoteSent: false, quoteAccepted: false, clientApprovedOnSpot: false, paymentProof: false, paymentVerified: false,
  dealApproved: false, designStagesDone: [], materialListSignedOff: false,
});
const step = (key: string, check: FlowStepDefinition["check"], column: string, extra: Partial<FlowStepDefinition> = {}): FlowStepDefinition =>
  ({ key, name: key, role: "sales", check, column, ...extra });
const COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];
const proof = () => step("payment_proof", "payment_proof_attached", "won");
const material = (extra: Partial<FlowStepDefinition> = {}) => step("material_selection", "design_stage_done", "proposal", { designStage: "material_selection", ...extra });
const line = (steps: FlowStepDefinition[], branches: FlowDefinition["branches"] = []): FlowDefinition => ({ schema: 1, columns: COLUMNS, steps, branches });
const keys = (definition: FlowDefinition, facts: CheckFacts, column: string) => requirementsUpTo(definition, facts, COLUMNS.indexOf(column)).map((item) => item.key);

describe("CeCe's cell rules on the flow definition (Required / Auto-passed / Used if needed / Skipped)", () => {
  it("accepts an auto-passed step and refuses one that is also used if needed, or an auto-passed payment proof", () => {
    expect(validateFlowDefinition(line([step("feasibility", "feasibility_confirmed", "qualification", { auto: true }), proof()])).ok).toBe(true);
    const both = validateFlowDefinition(line([step("feasibility", "feasibility_confirmed", "qualification", { auto: true, optional: true }), proof()]));
    expect(both.ok ? [] : both.errors.map((error) => error.path)).toEqual(["steps[0].auto"]);
    const proofAuto = validateFlowDefinition(line([{ ...proof(), auto: true }]));
    expect(proofAuto.ok ? [] : proofAuto.errors.map((error) => error.path)).toEqual(["steps[0].auto", "steps[0]"]);
    expect(validateFlowDefinition(line([step("feasibility", "feasibility_confirmed", "qualification", { auto: "yes" as never }), proof()])).ok).toBe(false);
  });

  it("computes the steps per path: auto-passed is done and never blocks; required blocks; used if needed never blocks", () => {
    // Qualified: auto-passed on A, required (feasibility) on E. Negotiation: skipped on A, used if needed on E.
    const definition = line([step("sub_path", "sub_path_chosen", "qualification"), step("quotation", "quote_exists", "proposal"), proof()], [
      { key: "paths", question: "subPath", after: "sub_path", rejoin: "quotation", answers: [
        { value: "take_home_now", steps: [step("feasibility_a", "feasibility_confirmed", "qualification", { auto: true })] },
        { value: "bespoke", steps: [step("feasibility_e", "feasibility_confirmed", "qualification")] },
      ] },
      { key: "paths_2", question: "subPath", after: "quotation", rejoin: "payment_proof", answers: [
        { value: "take_home_now", steps: [] },
        { value: "bespoke", steps: [step("negotiation_e", "client_approved_on_spot", "negotiation", { optional: true })] },
      ] },
    ]);
    expect(validateFlowDefinition(definition).errors).toEqual([]);
    const pathA = { ...empty(), furniturePath: "take_home_now" as const };
    const pathE = { ...empty(), furniturePath: "bespoke" as const };
    expect(keys(definition, pathA, "qualification")).toEqual([]);
    expect(keys(definition, pathE, "qualification")).toEqual(["feasibility"]);
    expect(keys(definition, { ...pathE, quotationExists: true, feasibilityConfirmed: true }, "negotiation")).toEqual([]);
    const progress = flowProgress(definition, pathA);
    expect(progress.line.map((item) => [item.key, item.state, item.auto ?? false])).toEqual([
      ["sub_path", "done", false], ["feasibility_a", "done", true], ["quotation", "current", false], ["payment_proof", "upcoming", false],
    ]);
  });

  it("an auto-passed step late in the line doesn't pass over the steps before it", () => {
    const definition = line([step("intro", "intro_meeting_completed", "qualification", { optional: true }), step("feasibility", "feasibility_confirmed", "proposal", { auto: true }), proof()]);
    expect(flowProgress(definition, empty()).current?.key).toBe("intro");
  });
});

describe("E2-5 / PLM-081: a job marks a step not needed, with a reason", () => {
  const skip = { reason: "Client keeps the existing finishes", by: "Sara", at: "2026-10-06T08:00:00.000Z" };

  it("is allowed for a step used if needed and for material selection; never for a required step or the payment proof", () => {
    expect(canSkipStep(step("negotiation", "client_approved_on_spot", "negotiation", { optional: true }))).toBe(true);
    expect(canSkipStep(material())).toBe(true);
    expect(canSkipStep(step("quotation", "quote_exists", "proposal"))).toBe(false);
    expect(canSkipStep({ ...proof(), optional: true })).toBe(false);
  });

  it("material selection blocks until it is done or marked Not required for this order; the line shows the reason", () => {
    const definition = line([material(), step("quotation", "quote_exists", "proposal"), proof()]);
    expect(keys(definition, empty(), "proposal")).toEqual(["designStage:material_selection", "quotation"]);
    const facts = { ...empty(), skippedSteps: { material_selection: skip } };
    expect(keys(definition, facts, "proposal")).toEqual(["quotation"]);
    const marked = flowProgress(definition, facts).line[0];
    expect(marked).toMatchObject({ state: "skipped", skip: { reason: skip.reason, by: "Sara", at: skip.at } });
    expect(flowProgress(definition, { ...empty(), designStagesDone: ["material_selection"] }).line[0].state).toBe("done");
  });

  it("ignores a recorded skip on a step the type now requires", () => {
    const definition = line([step("quotation", "quote_exists", "proposal"), proof()]);
    expect(keys(definition, { ...empty(), skippedSteps: { quotation: skip } }, "proposal")).toEqual(["quotation"]);
  });
});

describe("E2-2: a gate's evidence is removed", () => {
  it("reopens the step and flags the later done steps without undoing them", () => {
    const definition = line([step("quotation", "quote_exists", "proposal"), step("sent", "quote_sent", "proposal"), proof()]);
    const progress = flowProgress(definition, { ...empty(), quotationExists: false, quoteSent: true });
    expect(progress.current?.key).toBe("quotation");
    expect(progress.line.map((item) => [item.key, item.state, item.afterReopened ?? false])).toEqual([
      ["quotation", "current", false], ["sent", "done", true], ["payment_proof", "upcoming", false],
    ]);
  });
});

describe("PLM-081: the publisher's rule for furniture and joinery flows", () => {
  it("asks for material selection on every furniture path when the flow has none", () => {
    const problems = flowPolicyProblems(STARTER_FLOWS.furniture.definition);
    expect(problems.map((problem) => problem.path)).toEqual(["paths.take_home_now", "paths.in_stock_delivery", "paths.supplier_order", "paths.core_collection_factory", "paths.bespoke"]);
  });

  it("is satisfied by the templates, and doesn't apply to a design flow", () => {
    for (const key of ["furniture_all_paths", "fit_out_joinery", "full_fit_out", "renovation"])
      expect(flowPolicyProblems(flowTemplate(key)!.definition), key).toEqual([]);
    expect(flowPolicyProblems(STARTER_FLOWS.design.definition)).toEqual([]);
    for (const template of FLOW_TEMPLATES) expect(validateFlowDefinition(structuredClone(template.definition)).errors, template.key).toEqual([]);
  });

  it("refuses material selection that is used if needed or auto-passed, and a path without it", () => {
    const definition = structuredClone(flowTemplate("fit_out_joinery")!.definition);
    definition.steps.find((item) => item.key === "material_selection")!.optional = true;
    expect(flowPolicyProblems(definition).map((problem) => problem.path)).toEqual(["steps[5].optional", "steps"]);
  });

  it("splits a definition into its paths", () => {
    expect(definitionPaths(STARTER_FLOWS.basic.definition).map((path) => path.value)).toEqual([null]);
    const bespoke = definitionPaths(STARTER_FLOWS.furniture.definition).find((path) => path.value === "bespoke")!;
    expect(bespoke.steps.map((item) => item.key)).toEqual(["enquiry_type", "sub_path", "client_type", "feasibility", "quotation", "negotiation", "payment_proof"]);
  });
});

describe("E2-3: moving a running job to a newer version", () => {
  it("previews the step it would be on, what its column now also needs and the steps it drops", () => {
    const from = line([step("intro", "intro_meeting_completed", "qualification"), step("quotation", "quote_exists", "proposal"), proof()]);
    const to = line([step("intro", "intro_meeting_completed", "qualification"), material(), step("quotation", "quote_exists", "proposal"), proof()]);
    const facts = { ...empty(), introCompleted: true, quotationExists: true };
    const effect = migrationEffect({ from, to, facts, column: "proposal" });
    expect(effect).toMatchObject({ nowBefore: { key: "payment_proof" }, nowAfter: { key: "material_selection" }, dropped: [], added: [{ key: "material_selection" }], changed: true });
    expect(effect.newlyMissing).toEqual([{ key: "designStage:material_selection", label: "Material selection done", stepKey: "material_selection" }]);
    const back = migrationEffect({ from: to, to: from, facts: { ...facts, designStagesDone: ["material_selection"] }, column: "proposal" });
    expect(back.dropped).toEqual([{ key: "material_selection", name: "material_selection" }]);
    expect(migrationEffect({ from, to: from, facts, column: "proposal" }).changed).toBe(false);
  });
});

describe("PLM-080 / PLM-044: the joinery site visit in time both people have free", () => {
  const calendar: WorkCalendar = { timeZone: "Europe/London", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "13:00", holidays: [] };
  const host = (membershipId: string, busy: Array<[string, string]> = []): HostAvailability =>
    ({ membershipId, leave: [], overrides: [], busy: busy.map(([start, end]) => ({ start: Date.parse(start), end: Date.parse(end) })), bookedPerDay: {} });

  it("offers only the times the salesperson and the designer are both free", () => {
    const slots = jointSlots({ calendar, people: ["sales", "designer"], minutes: 120, from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z"),
      hosts: [host("sales", [["2031-03-03T09:00:00Z", "2031-03-03T10:00:00Z"]]), host("designer", [["2031-03-03T12:30:00Z", "2031-03-03T13:00:00Z"]])] });
    expect(slots.map((slot) => slot.start)).toEqual(["2031-03-03T10:00:00.000Z", "2031-03-03T10:30:00.000Z"]);
  });

  it("offers nothing when one of them is on leave", () => {
    const away = { ...host("designer"), leave: [{ start: "2031-03-03", end: "2031-03-03", dayPart: "full" as const }] };
    expect(jointSlots({ calendar, people: ["sales", "designer"], minutes: 60, from: "2031-03-03", to: "2031-03-03", now: new Date("2031-03-01T00:00:00Z"), hosts: [host("sales"), away] })).toEqual([]);
  });

  it("takes a visit of whole half hours from 30 minutes to 8 hours, and applies to flows with a site visit", () => {
    expect([visitMinutes(undefined), visitMinutes("90"), visitMinutes(45), visitMinutes(600), visitMinutes("x")]).toEqual([120, 90, null, null, null]);
    expect(siteVisitApplies(flowTemplate("fit_out_joinery")!.definition)).toBe(true);
    expect(siteVisitApplies(STARTER_FLOWS.furniture.definition)).toBe(false);
  });
});
