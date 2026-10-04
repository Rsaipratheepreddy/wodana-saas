import { describe, expect, it } from "vitest";
import {
  BAND_GAP, canMove, canRemove, definitionToGraph, graphToDefinition, insertBranch, insertStep, moveStep, nodeOrder, problemsFor, removeNode,
  updateBranch, updateStep, type FlowDefinition, type FlowStep,
} from "./flow-model";

const COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];
const step = (key: string, check: FlowStep["check"], column: string, extra: Partial<FlowStep> = {}): FlowStep => ({ key, name: key, role: "sales", check, column, ...extra });
const proof = step("payment_proof", "payment_proof_attached", "won", { clientVisible: true });

/** The furniture starter: a branch on sub-path A–E where only E (bespoke) has a step. */
const furniture = (): FlowDefinition => ({
  schema: 1, columns: COLUMNS,
  steps: [
    step("enquiry_type", "details_complete", "qualification", { needs: ["enquiryType"] }),
    step("sub_path", "sub_path_chosen", "qualification"),
    step("client_type", "client_type_set", "qualification"),
    step("quotation", "quote_exists", "proposal"),
    step("negotiation", "client_approved_on_spot", "negotiation", { optional: true, clientVisible: true }),
    proof,
  ],
  branches: [{
    key: "sub_path_branch", question: "subPath", after: "client_type", rejoin: "quotation",
    answers: [
      { value: "take_home_now", steps: [] }, { value: "in_stock_delivery", steps: [] }, { value: "supplier_order", steps: [] },
      { value: "core_collection_factory", steps: [] },
      { value: "bespoke", steps: [step("feasibility", "feasibility_confirmed", "qualification", { role: "factory_lead" })] },
    ],
  }],
});
const basic = (): FlowDefinition => ({ schema: 1, columns: COLUMNS, steps: [step("enquiry_type", "details_complete", "qualification", { needs: ["enquiryType"] }), proof], branches: [] });
const twoLanes = (): FlowDefinition => ({
  ...basic(),
  steps: [step("client_type", "client_type_set", "qualification"), step("quote", "quote_exists", "proposal"), proof],
  branches: [{ key: "by_client", question: "clientType", after: "client_type", rejoin: "quote", answers: [
    { value: "end_user", steps: [step("intro", "intro_meeting_completed", "qualification"), step("visit", "site_visit_recorded", "proposal")] },
    { value: "developer", steps: [step("approval", "deal_approved", "proposal", { role: "manager" })] },
  ] }],
});

describe("definition ⇄ graph", () => {
  it.each([["basic", basic], ["furniture", furniture], ["two lanes", twoLanes]])("round-trips the %s flow exactly", (_name, make) => {
    const definition = make();
    expect(graphToDefinition(definitionToGraph(definition), COLUMNS)).toEqual(definition);
    expect(graphToDefinition(definitionToGraph(definition, { rtl: true }), COLUMNS)).toEqual(definition);
  });

  it("lays the line out top to bottom, forks a branch into answer exits and rejoins at the next step", () => {
    const { nodes, edges } = definitionToGraph(furniture());
    const y = (id: string) => nodes.find((node) => node.id === id)!.position.y;
    expect(y("enquiry_type")).toBeLessThan(y("sub_path"));
    expect(y("sub_path_branch")).toBeLessThan(y("feasibility"));
    expect(y("feasibility")).toBeLessThan(y("quotation"));
    expect(edges.filter((edge) => edge.source === "sub_path_branch").map((edge) => [edge.sourceHandle, edge.target])).toEqual(expect.arrayContaining([
      ["take_home_now", "quotation"], ["in_stock_delivery", "quotation"], ["supplier_order", "quotation"], ["core_collection_factory", "quotation"], ["bespoke", "feasibility"],
    ]));
    expect(edges.find((edge) => edge.source === "feasibility")).toMatchObject({ target: "quotation", data: { kind: "rejoin" } });
  });

  it("draws one band per column used, in order and without overlap, and mirrors the picture in right-to-left", () => {
    const bands = definitionToGraph(furniture()).nodes.filter((node) => node.type === "band");
    expect(bands.map((band) => band.id)).toEqual(["band:qualification", "band:proposal", "band:negotiation", "band:won"]);
    for (let index = 1; index < bands.length; index += 1) expect(bands[index].position.y).toBeGreaterThanOrEqual(bands[index - 1].position.y + bands[index - 1].height);
    const ltr = definitionToGraph(twoLanes()).nodes.find((node) => node.id === "intro")!;
    const rtl = definitionToGraph(twoLanes(), { rtl: true }).nodes.find((node) => node.id === "intro")!;
    expect(rtl.position.x).toBe(-ltr.position.x - ltr.width);
  });

  it("keeps the same gap between bands, wraps every card in its band and spaces cards by their measured height", () => {
    const design: FlowDefinition = { schema: 1, columns: COLUMNS, branches: [], steps: [
      step("details", "details_complete", "qualified", { needs: ["clientEmail"] }), step("enquiry", "details_complete", "qualification", { needs: ["enquiryType"] }),
      step("intro", "intro_meeting_completed", "qualification"), step("quote", "quote_exists", "proposal"), proof,
    ] };
    const { nodes } = definitionToGraph(design, { heights: { details: 150, intro: 140 } });
    const bands = nodes.filter((node) => node.type === "band");
    expect(bands.map((band) => band.id)).toEqual(["band:qualified", "band:qualification", "band:proposal", "band:won"]);
    for (let index = 1; index < bands.length; index += 1) expect(bands[index].position.y - (bands[index - 1].position.y + bands[index - 1].height)).toBe(BAND_GAP);
    const at = (id: string) => nodes.find((node) => node.id === id)!;
    expect(at("enquiry").position.y).toBeGreaterThanOrEqual(at("details").position.y + 150);
    for (const card of nodes.filter((node) => node.type === "step")) {
      const band = bands.find((item) => (item.data as { column: string }).column === (card.data as { step: FlowStep }).step.column)!;
      expect(card.position.y).toBeGreaterThan(band.position.y);
      expect(card.position.y + card.height).toBeLessThan(band.position.y + band.height);
    }
  });

  it("reads nodes in order for the keyboard: a step, its branch, each answer's steps, then the line", () => {
    expect(nodeOrder(twoLanes())).toEqual(["client_type", "by_client", "intro", "visit", "approval", "quote", "payment_proof"]);
  });
});

describe("editing", () => {
  it("adds a step after the selected one, keeping the payment proof last", () => {
    const appended = insertStep(basic(), null, "intro_meeting_completed", "Hold the intro meeting");
    expect(appended.definition.steps.map((item) => item.key)).toEqual(["enquiry_type", "intro_meeting", "payment_proof"]);
    expect(appended.definition.steps[1]).toEqual({ key: "intro_meeting", name: "Hold the intro meeting", role: "sales", check: "intro_meeting_completed", column: "qualification" });
    const afterProof = insertStep(basic(), "payment_proof", "quote_sent", "Send");
    expect(afterProof.definition.steps.at(-1)!.key).toBe("payment_proof");
    expect(afterProof.definition.steps[1].column).toBe("qualification");
    expect(insertStep(appended.definition, null, "intro_meeting_completed", "Again").id).toBe("intro_meeting_2");
  });

  it("puts a step after a branch where the paths rejoin, and a step after a branching step before its branch", () => {
    const afterBranch = insertStep(furniture(), "sub_path_branch", "quote_sent", "Send");
    expect(afterBranch.definition.branches[0]).toMatchObject({ after: "client_type", rejoin: afterBranch.id });
    const beforeBranch = insertStep(furniture(), "client_type", "contact_logged", "Call");
    expect(beforeBranch.definition.branches[0]).toMatchObject({ after: beforeBranch.id, rejoin: "quotation" });
    const inLane = insertStep(furniture(), "feasibility", "design_stage_done", "Concepts");
    expect(inLane.definition.branches[0].answers[4].steps.map((item) => [item.key, item.designStage])).toEqual([["feasibility", undefined], ["design_stage", "concepts"]]);
  });

  it("adds a branch only after a main step that has none, with the question asked before it", () => {
    const added = insertBranch(basic(), "enquiry_type", {});
    expect(added?.definition.branches[0]).toEqual({ key: "branch", question: "clientType", after: "enquiry_type", rejoin: "payment_proof", answers: [] });
    expect(insertBranch(furniture(), "client_type", {})).toBeNull();
    expect(insertBranch(furniture(), "payment_proof", {})).toBeNull();
    expect(insertBranch(furniture(), "feasibility", {})).toBeNull();
    const subPath = insertBranch(furniture(), "sub_path", {});
    expect(subPath?.definition.branches[1].answers.map((answer) => answer.value)).toEqual(["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory", "bespoke"]);
  });

  it("removes steps and branches; the payment proof that ends the flow stays", () => {
    expect(canRemove(furniture(), "payment_proof")).toBe(false);
    expect(removeNode(furniture(), "payment_proof")).toEqual(furniture());
    expect(removeNode(furniture(), "sub_path_branch").branches).toEqual([]);
    const withoutAsker = removeNode(furniture(), "client_type");
    expect(withoutAsker.branches[0]).toMatchObject({ after: "sub_path", rejoin: "quotation" });
    expect(removeNode(furniture(), "quotation").branches[0].rejoin).toBe("negotiation");
    expect(removeNode(furniture(), "feasibility").branches[0].answers[4].steps).toEqual([]);
  });

  it("edits a step's properties, dropping what no longer applies", () => {
    const edited = updateStep(furniture(), "negotiation", { optional: false, deadline: { amount: 2, unit: "days" }, notify: ["manager"], check: "design_stage_done" });
    expect(edited.steps[4]).toEqual({ key: "negotiation", name: "negotiation", role: "sales", check: "design_stage_done", designStage: "concepts", column: "negotiation", clientVisible: true, deadline: { amount: 2, unit: "days" }, notify: ["manager"] });
    expect(updateStep(edited, "negotiation", { deadline: undefined, check: "quote_sent" }).steps[4]).toEqual({ key: "negotiation", name: "negotiation", role: "sales", check: "quote_sent", column: "negotiation", clientVisible: true, notify: ["manager"] });
    expect(updateStep(furniture(), "feasibility", { role: "factory" }).branches[0].answers[4].steps[0].role).toBe("factory");
    expect(updateStep(basic(), "enquiry_type", { check: "details_complete", needs: [] }).steps[0].needs).toEqual(["clientEmail"]);
  });

  it("changes a branch's answers and question, keeping the steps of answers that stay", () => {
    const options = { clientType: [{ value: "end_user", label: "End user" }, { value: "developer", label: "Developer" }, { value: "investor", label: "Investor" }] };
    const fewer = updateBranch(furniture(), "sub_path_branch", { answers: ["bespoke", "take_home_now"] }, options);
    expect(fewer.branches[0].answers.map((answer) => [answer.value, answer.steps.length])).toEqual([["take_home_now", 0], ["bespoke", 1]]);
    const asked = updateBranch(twoLanes(), "by_client", { answers: ["investor", "end_user", "developer"] }, options);
    expect(asked.branches[0].answers.map((answer) => [answer.value, answer.steps.length])).toEqual([["end_user", 2], ["developer", 1], ["investor", 0]]);
    expect(updateBranch(twoLanes(), "by_client", { question: "subPath" }, options).branches[0].answers).toHaveLength(5);
  });

  it("moves a step along its own path; nothing passes the payment proof", () => {
    expect(moveStep(furniture(), "quotation", -1).steps.map((item) => item.key).slice(2, 4)).toEqual(["quotation", "client_type"]);
    expect(moveStep(furniture(), "quotation", -1).branches[0]).toMatchObject({ after: "client_type", rejoin: "negotiation" });
    expect(canMove(furniture(), "negotiation", 1)).toBe(false);
    expect(canMove(furniture(), "enquiry_type", -1)).toBe(false);
    expect(canMove(twoLanes(), "visit", -1)).toBe(true);
  });
});

describe("publishing problems", () => {
  it("points each validator error at the card and property it is about", () => {
    expect(problemsFor([
      { path: "steps[1].role", message: "Every step has a role" },
      { path: "branches[0].answers[4].steps[0].column", message: "Columns only move forward along every path" },
      { path: "branches[0].question", message: "Ask the question in a step before the branch" },
      { path: "steps[5]", message: "The flow ends with a required payment proof step that enters Won" },
      { path: "columns", message: "The last column is Won" },
    ], furniture())).toEqual([
      { nodeId: "sub_path", field: "role", message: "Every step has a role", path: "steps[1].role" },
      { nodeId: "feasibility", field: "column", message: "Columns only move forward along every path", path: "branches[0].answers[4].steps[0].column" },
      { nodeId: "sub_path_branch", field: "question", message: "Ask the question in a step before the branch", path: "branches[0].question" },
      { nodeId: "payment_proof", field: null, message: "The flow ends with a required payment proof step that enters Won", path: "steps[5]" },
      { nodeId: null, field: null, message: "The last column is Won", path: "columns" },
    ]);
  });
});
