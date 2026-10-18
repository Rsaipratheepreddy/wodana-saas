import { describe, expect, it } from "vitest";
import type { FlowDefinition, FlowStep } from "./flow-model";
import {
  addRow, ALL_PATHS, canChangeQuestion, definitionToTable, moveRow, problemKeyFor, removeRow, rowsByStage, sameOnEveryPath, setCell, setQuestion,
  tableProblems, tableToDefinition, updateRow, type StepsTable,
} from "./steps-table";

const COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];
const step = (key: string, check: FlowStep["check"], column: string, extra: Partial<FlowStep> = {}): FlowStep => ({ key, name: key.replaceAll("_", " "), role: "sales", check, column, ...extra });
const proof = () => step("payment_proof", "payment_proof_attached", "won", { clientVisible: true });
/** The furniture starter flow: a branch on sub-paths A–E, feasibility only for bespoke. */
const furniture = (): FlowDefinition => ({
  schema: 1, columns: COLUMNS,
  steps: [
    step("enquiry_type", "details_complete", "qualification", { needs: ["enquiryType"] }),
    step("sub_path", "sub_path_chosen", "qualification"),
    step("client_type", "client_type_set", "qualification"),
    step("quotation", "quote_exists", "proposal"),
    step("negotiation", "client_approved_on_spot", "negotiation", { optional: true, clientVisible: true }),
    proof(),
  ],
  branches: [{ key: "sub_path_branch", question: "subPath", after: "client_type", rejoin: "quotation", answers: [
    { value: "take_home_now", steps: [] }, { value: "in_stock_delivery", steps: [] }, { value: "supplier_order", steps: [] }, { value: "core_collection_factory", steps: [] },
    { value: "bespoke", steps: [step("feasibility", "feasibility_confirmed", "qualification", { role: "factory_lead" })] },
  ] }],
});
const design = (): FlowDefinition => ({ schema: 1, columns: COLUMNS, steps: [step("details", "details_complete", "qualified", { needs: ["clientEmail"] }), step("intro", "intro_meeting_completed", "qualification"), proof()], branches: [] });
const read = (definition: FlowDefinition) => definitionToTable(definition) as StepsTable;
const cells = (table: StepsTable, key: string) => table.paths.map((path) => table.rows.find((row) => row.key === key)!.cells[path].rule);
const material = (extra: Partial<FlowStep> = {}) => step("material_selection", "design_stage_done", "proposal", { designStage: "material_selection", ...extra });

describe("the steps table reads the same flow definition as the canvas (no second model)", () => {
  it("shows the furniture paths A–E as columns and each step's rule per path", () => {
    const table = read(furniture());
    expect(table.question).toBe("subPath");
    expect(table.paths).toEqual(["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory", "bespoke"]);
    expect(table.rows.map((row) => row.key)).toEqual(["enquiry_type", "sub_path", "client_type", "feasibility", "quotation", "negotiation", "payment_proof"]);
    expect(cells(table, "feasibility")).toEqual(["skipped", "skipped", "skipped", "skipped", "required"]);
    expect(cells(table, "negotiation")).toEqual(Array(5).fill("optional"));
    expect(table.rows.find((row) => row.key === "feasibility")!.cells.bespoke.step?.role).toBe("factory_lead");
  });

  it("writes back exactly the definition it read", () => {
    expect(tableToDefinition(read(furniture()), COLUMNS)).toEqual({ definition: furniture(), problems: [] });
    const single = read(design());
    expect(single.paths).toEqual([ALL_PATHS]);
    expect(tableToDefinition(single, COLUMNS)).toEqual({ definition: design(), problems: [] });
  });

  it("refuses a type that splits on two questions (edit it on the canvas)", () => {
    const definition = furniture();
    definition.branches.push({ key: "by_client", question: "clientType", after: "quotation", rejoin: "negotiation", answers: [{ value: "end_user", steps: [] }] });
    expect(definitionToTable(definition)).toEqual({ unsupported: "questions" });
  });

  it("groups the rows by stage, in order", () => {
    expect(rowsByStage(read(furniture())).map((group) => [group.column, group.rows.length])).toEqual([["qualification", 4], ["proposal", 1], ["negotiation", 1], ["won", 1]]);
  });
});

describe("CeCe's cells → the computed steps", () => {
  it("Auto-passed on A–D and Required on E: one step per path, auto-passed where it passes on its own", () => {
    let table = read(furniture());
    for (const path of ["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory"]) table = setCell(table, "feasibility", path, { rule: "auto" });
    const { definition, problems } = tableToDefinition(table, COLUMNS);
    expect(problems).toEqual([]);
    const lanes = definition.branches[0].answers.map((answer) => answer.steps.map((item) => [item.key, item.auto ?? false, item.role]));
    expect(lanes).toEqual([[["feasibility_a", true, "factory_lead"]], [["feasibility_b", true, "factory_lead"]], [["feasibility_c", true, "factory_lead"]], [["feasibility_d", true, "factory_lead"]], [["feasibility_e", false, "factory_lead"]]]);
    // Read back: the same cells.
    expect(cells(read(definition), "feasibility")).toEqual(["auto", "auto", "auto", "auto", "required"]);
    expect(tableToDefinition(read(definition), COLUMNS).definition).toEqual(definition);
  });

  it("Negotiation skipped on A, used if needed elsewhere: a second split after the quotation, rejoining at the payment proof", () => {
    const table = setCell(read(furniture()), "negotiation", "take_home_now", { rule: "skipped" });
    const { definition, problems } = tableToDefinition(table, COLUMNS);
    expect(problems).toEqual([]);
    expect(definition.steps.map((item) => item.key)).toEqual(["enquiry_type", "sub_path", "client_type", "quotation", "payment_proof"]);
    expect(definition.branches.map((branch) => [branch.key, branch.after, branch.rejoin])).toEqual([["sub_path_branch", "client_type", "quotation"], ["paths", "quotation", "payment_proof"]]);
    expect(definition.branches[1].answers.map((answer) => answer.steps.map((item) => `${item.key}:${item.optional ? "optional" : "required"}`)))
      .toEqual([[], ["negotiation_b:optional"], ["negotiation_c:optional"], ["negotiation_d:optional"], ["negotiation_e:optional"]]);
    expect(cells(read(definition), "negotiation")).toEqual(["skipped", "optional", "optional", "optional", "optional"]);
  });

  it("owner team and lead time per cell; the same on every path is one main-line step again", () => {
    let table = setCell(read(furniture()), "quotation", "bespoke", { role: "quantity_surveyor", deadline: { amount: 5, unit: "days" } });
    let written = tableToDefinition(table, COLUMNS).definition;
    expect(written.steps.map((item) => item.key)).not.toContain("quotation");
    expect(written.branches[0].answers[4].steps.map((item) => [item.key, item.role, item.deadline])).toEqual([["feasibility", "factory_lead", undefined], ["quotation_e", "quantity_surveyor", { amount: 5, unit: "days" }]]);
    table = sameOnEveryPath(table, "quotation", "bespoke");
    written = tableToDefinition(table, COLUMNS).definition;
    expect(written.steps.find((item) => item.key === "quotation")).toMatchObject({ role: "quantity_surveyor", deadline: { amount: 5, unit: "days" } });
  });

  it("renames a step on every path that had its name, and moves it to another stage", () => {
    const table = updateRow(read(furniture()), "quotation", { name: "Quote with the lead time", column: "negotiation" });
    const written = tableToDefinition(table, COLUMNS).definition;
    expect(written.steps.find((item) => item.key === "quotation")).toMatchObject({ name: "Quote with the lead time", column: "negotiation" });
  });
});

describe("every problem at once", () => {
  it("names the proof, steps before the path is chosen, unused steps, backward stages and material selection (PLM-081)", () => {
    let table = read(furniture());
    table = setCell(table, "payment_proof", "bespoke", { rule: "optional" });
    table = setCell(table, "enquiry_type", "bespoke", { rule: "skipped" });
    for (const path of table.paths) table = setCell(table, "negotiation", path, { rule: "skipped" });
    table = updateRow(table, "client_type", { column: "won" });
    const keys = tableProblems(table, COLUMNS).map((problem) => problem.key);
    expect(keys).toEqual(expect.arrayContaining(["row:enquiry_type", "row:negotiation", "row:payment_proof", "cell:payment_proof:bespoke", "material"]));
    expect(keys.filter((key) => key.startsWith("cell:feasibility"))).toEqual(["cell:feasibility:bespoke"]);
  });

  it("asks for material selection required on every furniture path, and is satisfied when it is", () => {
    const definition = furniture();
    definition.steps.splice(3, 0, material());
    definition.branches[0].rejoin = "material_selection";
    expect(tableProblems(read(definition), COLUMNS)).toEqual([]);
    const optional = setCell(read(definition), "material_selection", "take_home_now", { rule: "optional" });
    expect(tableProblems(optional, COLUMNS).map((problem) => problem.key)).toEqual(["cell:material_selection:take_home_now"]);
    expect(tableProblems(read(design()), COLUMNS)).toEqual([]);
  });

  it("points a validator error at its cell or row", () => {
    const table = setCell(read(furniture()), "quotation", "bespoke", { role: "quantity_surveyor" });
    const { definition } = tableToDefinition(table, COLUMNS);
    expect(problemKeyFor({ path: "branches[0].answers[4].steps[1].role", message: "x" }, definition, table)).toBe("cell:quotation:bespoke");
    expect(problemKeyFor({ path: "steps[1].column", message: "x" }, definition, table)).toBe("row:sub_path");
    expect(problemKeyFor({ path: "columns", message: "x" }, definition, table)).toBe("table");
  });
});

describe("editing the table", () => {
  it("adds a step before the payment proof, moves steps but never past the proof, and never removes the proof", () => {
    const added = addRow(read(design()), { check: "design_stage_done", designStage: "material_selection", name: "Choose the materials", column: "proposal" });
    expect(added.key).toBe("material_selection");
    expect(added.table.rows.map((row) => row.key)).toEqual(["details", "intro", "material_selection", "payment_proof"]);
    expect(moveRow(added.table, "material_selection", 1)).toBe(added.table);
    expect(moveRow(added.table, "material_selection", -1).rows.map((row) => row.key)).toEqual(["details", "material_selection", "intro", "payment_proof"]);
    expect(removeRow(added.table, "payment_proof")).toBe(added.table);
    expect(removeRow(added.table, "intro").rows.map((row) => row.key)).toEqual(["details", "material_selection", "payment_proof"]);
  });

  it("splits a one-column type by a question, copying each step to every path, and only goes back while every path is the same", () => {
    const split = setQuestion(read(design()), "clientType", { clientType: [{ value: "end_user", label: "End user" }, { value: "developer", label: "Developer" }] });
    expect(split.paths).toEqual(["end_user", "developer"]);
    expect(cells(split, "intro")).toEqual(["required", "required"]);
    expect(canChangeQuestion(split)).toBe(true);
    const differs = setCell(split, "intro", "developer", { rule: "optional" });
    expect(canChangeQuestion(differs)).toBe(false);
    expect(setQuestion(differs, null)).toBe(differs);
    expect(setQuestion(split, null).paths).toEqual([ALL_PATHS]);
    // Split by client type, without the step that asks it: the table says so.
    expect(tableProblems(differs, COLUMNS).map((problem) => problem.message)).toContain("Add the step that chooses the path");
  });
});
