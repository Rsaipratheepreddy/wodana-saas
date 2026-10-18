import { tKey, type MessageKey } from "@/lib/i18n/keys";
import {
  answerOptions, checkMeta, cleanStep, WON_COLUMN, type AnswerOptions, type BranchQuestion, type DeadlineUnit, type DesignStage, type FlowBranch, type FlowCheck,
  type FlowDefinition, type FlowStep, type FlowValidationError,
} from "./flow-model";

/**
 * Plan §6.9a, "Steps editor in CeCe's words": an enquiry type's steps as CeCe's table — stages as rows, paths as
 * columns (Furniture A–E, a design type's packages, one column for a type that doesn't split), each cell the step's
 * rule on that path (Required / Auto-passed / Used if needed / Skipped) with its owner team and lead time.
 *
 * It is a view of the SAME flow definition the canvas edits (no second model): `definitionToTable` reads it and
 * `tableToDefinition` writes it back. A step that is the same on every path is a main-line step; a step that differs
 * becomes one step per path in a branch on the path question, between the main steps around it; "Skipped" is no step
 * on that path; "Auto-passed" is a step that passes on its own. Pure functions only.
 */

export const CELL_RULES = ["required", "auto", "optional", "skipped"] as const;
export type CellRule = (typeof CELL_RULES)[number];
export const CELL_RULE_LABELS: Record<CellRule, MessageKey> = {
  required: tKey("Required"), auto: tKey("Auto-passed"), optional: tKey("Used if needed"), skipped: tKey("Skipped"),
};
/** The one column of a type whose steps don't split by path. */
export const ALL_PATHS = "all";

/** A step on one path: its rule, and the step itself (owner team, lead time, who is told…) when it applies. */
export type StepCell = { rule: CellRule; step: FlowStep | null };
export type StepRow = {
  key: string; name: string; check: FlowCheck; column: string;
  designStage?: DesignStage; needs?: FlowStep["needs"];
  cells: Record<string, StepCell>;
};
export type StepsTable = {
  /** The question the paths answer (null: one column). */
  question: BranchQuestion | null;
  paths: string[];
  rows: StepRow[];
  /** The branch keys the definition had, reused in order so the canvas and history keep their names. */
  branchKeys: string[];
};
export type TableProblem = { key: string; message: MessageKey; values?: Record<string, string> };

export const ruleOf = (step: FlowStep): CellRule => step.auto ? "auto" : step.optional ? "optional" : "required";
const applies = (cell: StepCell | undefined): cell is StepCell & { step: FlowStep } => Boolean(cell && cell.rule !== "skipped" && cell.step);
const isProof = (row: Pick<StepRow, "check">) => row.check === "payment_proof_attached";
export const isMaterialSelectionRow = (row: Pick<StepRow, "check" | "designStage">) => row.check === "design_stage_done" && row.designStage === "material_selection";

/** The letter a path's steps carry in their keys: A–E for the furniture sub-paths, else its place in the list. */
function pathCode(question: BranchQuestion | null, path: string, options: AnswerOptions) {
  if (!question) return "";
  const list = answerOptions(question, options);
  const option = list.find((item) => item.value === path);
  if (option?.letter) return option.letter.toLowerCase();
  const index = list.findIndex((item) => item.value === path);
  return String(index >= 0 ? index + 1 : path.length);
}

/** The paths a type shows: every sub-path (CeCe's A–E), else the answers its branches use, in the list's order. */
function orderedPaths(question: BranchQuestion, options: AnswerOptions, used: string[]) {
  const list = answerOptions(question, options).map((option) => option.value);
  if (question === "subPath") return [...list, ...used.filter((value) => !list.includes(value))];
  return [...list.filter((value) => used.includes(value)), ...used.filter((value) => !list.includes(value))];
}

const rowFrom = (step: FlowStep, paths: string[], applied: (path: string) => boolean): StepRow => ({
  key: step.key, name: step.name, check: step.check, column: step.column,
  ...(step.designStage ? { designStage: step.designStage } : {}), ...(step.needs ? { needs: [...step.needs] } : {}),
  cells: Object.fromEntries(paths.map((path) => [path, applied(path) ? { rule: ruleOf(step), step } : { rule: "skipped" as const, step: null }])),
});

/** Reads a definition as the table, or says why it can't (a type that splits on more than one question). */
export function definitionToTable(definition: FlowDefinition, options: AnswerOptions = {}): StepsTable | { unsupported: "questions" } {
  const questions = [...new Set(definition.branches.map((branch) => branch.question))];
  if (questions.length > 1) return { unsupported: "questions" };
  const question = questions[0] ?? null;
  const paths = question ? orderedPaths(question, options, [...new Set(definition.branches.flatMap((branch) => branch.answers.map((answer) => answer.value)))]) : [ALL_PATHS];
  const mainKeys = new Set(definition.steps.map((step) => step.key));
  const rows: StepRow[] = [];
  for (const step of definition.steps) {
    rows.push(rowFrom(step, paths, () => true));
    const branch = definition.branches.find((item) => item.after === step.key);
    if (!branch) continue;
    const segment: StepRow[] = [];
    for (const answer of branch.answers) {
      let cursor = -1;
      const code = pathCode(question, answer.value, options);
      for (const lane of answer.steps) {
        let key = code && lane.key.endsWith(`_${code}`) ? lane.key.slice(0, -(code.length + 1)) : lane.key;
        if (!key || mainKeys.has(key)) key = lane.key;
        let index = segment.findIndex((row) => row.key === key);
        if (index < 0) {
          index = cursor + 1;
          segment.splice(index, 0, { ...rowFrom(lane, paths, () => false), key });
        }
        segment[index].cells[answer.value] = { rule: ruleOf(lane), step: lane };
        cursor = index;
      }
    }
    rows.push(...segment);
  }
  return { question, paths, rows, branchKeys: definition.branches.map((branch) => branch.key) };
}

/** What makes two cells the same step: everything but its key. */
const signature = (cell: StepCell) => JSON.stringify(cell.step ? { ...cell.step, key: undefined, optional: undefined, auto: undefined, rule: cell.rule } : null);
export const isUniform = (table: StepsTable, row: StepRow) => {
  const cells = table.paths.map((path) => row.cells[path]);
  return cells.every(applies) && cells.every((cell) => signature(cell) === signature(cells[0]));
};

/** The step a cell writes: the row's check, stage and fields, the cell's owner, lead time and rule. */
function stepOf(row: StepRow, cell: StepCell & { step: FlowStep }, key: string): FlowStep {
  const { optional: _optional, auto: _auto, ...own } = cell.step;
  void _optional; void _auto;
  return cleanStep({
    ...own, key, name: own.name || row.name, check: row.check, column: row.column,
    ...(row.designStage ? { designStage: row.designStage } : {}), ...(row.needs ? { needs: [...row.needs] } : {}),
    ...(cell.rule === "optional" ? { optional: true } : {}), ...(cell.rule === "auto" ? { auto: true } : {}),
  });
}

/** Which step asks the path question (a branch must come after it). */
export function asksQuestion(question: BranchQuestion, row: Pick<StepRow, "check" | "needs">) {
  if (question === "subPath") return row.check === "sub_path_chosen";
  if (question === "package") return row.check === "package_chosen";
  if (question === "clientType") return row.check === "client_type_set";
  return Boolean(row.needs?.includes("budget"));
}

/**
 * Writes the table back as a definition. Rows the same on every path are the main line; each run of rows that
 * differ becomes a branch on the path question between the main rows around it. Returns the problems that stop it
 * from being one line (all of them), alongside the definition it could write.
 */
export function tableToDefinition(table: StepsTable, columns: string[], options: AnswerOptions = {}): { definition: FlowDefinition; problems: TableProblem[] } {
  const problems: TableProblem[] = [];
  const steps: FlowStep[] = [];
  const branches: FlowBranch[] = [];
  const question = table.question;
  const keys = new Set<string>();
  const take = (key: string) => { let candidate = key; for (let index = 2; keys.has(candidate); index += 1) candidate = `${key}_${index}`; keys.add(candidate); return candidate; };
  let lastMain: string | null = null;
  let pending: StepRow[] = [];
  const segments: Array<{ after: string; rows: StepRow[]; rejoin: string }> = [];
  for (const row of table.rows) {
    const applied = table.paths.filter((path) => applies(row.cells[path]));
    if (!applied.length) { problems.push({ key: `row:${row.key}`, message: tKey("Used on no path: choose a rule or remove the step") }); continue; }
    if (!question || isUniform(table, row)) {
      const key = take(row.key);
      if (pending.length && lastMain) segments.push({ after: lastMain, rows: pending, rejoin: key });
      pending = [];
      steps.push(stepOf(row, row.cells[table.paths[0]] as StepCell & { step: FlowStep }, key));
      lastMain = key;
      continue;
    }
    if (!lastMain || !steps.some((step) => asksQuestion(question, step))) {
      problems.push({ key: `row:${row.key}`, message: tKey("Differs by path before the path is chosen: make it the same on every path or move it after that step") });
      continue;
    }
    pending.push(row);
  }
  if (pending.length) for (const row of pending) problems.push({ key: `row:${row.key}`, message: tKey("Differs by path after the last step: the payment proof ends every path") });
  const reused = [...table.branchKeys];
  const branchKey = () => take(reused.shift() ?? "paths");
  for (const segment of segments) {
    const answers = table.paths.map((path) => {
      const code = pathCode(question, path, options);
      return {
        value: path,
        steps: segment.rows.filter((row) => applies(row.cells[path])).map((row) => {
          const several = table.paths.filter((other) => applies(row.cells[other])).length > 1;
          return stepOf(row, row.cells[path] as StepCell & { step: FlowStep }, take(several ? `${row.key.slice(0, 36)}_${code}` : row.key));
        }),
      };
    });
    branches.push({ key: branchKey(), question: question!, after: segment.after, rejoin: segment.rejoin, answers });
  }
  // A type split by path whose steps happen to be the same on every path keeps its paths, right after the step
  // that asks the question.
  if (question && !branches.length) {
    const at = steps.findIndex((step) => asksQuestion(question, step));
    if (at >= 0 && at < steps.length - 1) branches.push({ key: branchKey(), question, after: steps[at].key, rejoin: steps[at + 1].key, answers: table.paths.map((value) => ({ value, steps: [] })) });
  }
  if (question && !table.rows.some((row) => asksQuestion(question, row))) problems.push({ key: "table", message: tKey("Add the step that chooses the path") });
  return { definition: { schema: 1, columns: [...columns], steps, branches }, problems };
}

/** The steps one path runs, in order (the table's rows that apply on it). */
const pathRows = (table: StepsTable, path: string) => table.rows.filter((row) => applies(row.cells[path]));

/** A furniture or joinery type: it splits by sub-path, or a site visit is priced by the QS (PLM-081). */
export const isFurnitureOrJoinery = (table: StepsTable) => table.question === "subPath" || table.rows.some((row) => row.check === "sub_path_chosen")
  || (table.rows.some((row) => row.check === "site_visit_recorded") && table.rows.some((row) => row.check === "qs_approved"));

/**
 * Everything wrong with the table, all at once (E2-1/E2-2/E2-5 and the publisher's rules): the payment proof ends
 * every path and is required (Won ⇔ proof); steps only move forward through the stages on each path; a step that
 * differs by path comes after the step that chooses the path; every step is used on some path; on a furniture or
 * joinery type, material selection is required on every path (a job marks it not required, with a reason).
 */
export function tableProblems(table: StepsTable, columns: string[], options: AnswerOptions = {}): TableProblem[] {
  const problems = [...tableToDefinition(table, columns, options).problems];
  const last = table.rows.at(-1);
  if (!last || !isProof(last) || last.column !== WON_COLUMN) problems.push({ key: "table", message: tKey("End every path with the payment proof step") });
  for (const row of table.rows) {
    if (!isProof(row)) continue;
    for (const path of table.paths) if (row.cells[path]?.rule !== "required")
      problems.push({ key: `cell:${row.key}:${path}`, message: tKey("The payment proof is required on every path: Won needs it") });
  }
  for (const path of table.paths) {
    let previous = -1;
    for (const row of pathRows(table, path)) {
      const at = columns.indexOf(row.column);
      if (at >= 0 && at < previous) problems.push({ key: `cell:${row.key}:${path}`, message: tKey("Enters an earlier stage than the step before it") });
      previous = Math.max(previous, at);
    }
  }
  if (isFurnitureOrJoinery(table)) {
    const material = table.rows.find(isMaterialSelectionRow);
    if (!material) problems.push({ key: "material", message: tKey("Material selection is always a step on furniture and joinery paths") });
    else for (const path of table.paths) if (material.cells[path]?.rule !== "required")
      problems.push({ key: `cell:${material.key}:${path}`, message: tKey("Material selection is required on every path; a job marks it Not required for this order with a reason") });
  }
  return problems.filter((problem, index) => problems.findIndex((other) => other.key === problem.key && other.message === problem.message) === index);
}

/** Where a validator error belongs in the table: a cell, a row, or the table as a whole. */
export function problemKeyFor(error: FlowValidationError, definition: FlowDefinition, table: StepsTable, options: AnswerOptions = {}): string {
  const lane = /^branches\[(\d+)\]\.answers\[(\d+)\]\.steps\[(\d+)\]/.exec(error.path);
  if (lane) {
    const answer = definition.branches[+lane[1]]?.answers[+lane[2]];
    const step = answer?.steps[+lane[3]];
    const code = pathCode(table.question, answer?.value ?? "", options);
    const key = step ? (code && step.key.endsWith(`_${code}`) ? step.key.slice(0, -(code.length + 1)) : step.key) : null;
    const row = table.rows.find((item) => item.key === key) ?? table.rows.find((item) => item.key === step?.key);
    return row && answer ? `cell:${row.key}:${answer.value}` : "table";
  }
  const main = /^steps\[(\d+)\]/.exec(error.path);
  if (main) { const key = definition.steps[+main[1]]?.key; return table.rows.some((row) => row.key === key) ? `row:${key}` : "table"; }
  const path = /^paths\.(.+)$/.exec(error.path);
  if (path) { const material = table.rows.find(isMaterialSelectionRow); return material ? `cell:${material.key}:${path[1]}` : "material"; }
  return "table";
}

// ── Editing ──────────────────────────────────────────────────────────────────────────────────────────────────────

const copy = (table: StepsTable): StepsTable => structuredClone(table);
const someStep = (row: StepRow) => Object.values(row.cells).find((cell) => cell.step)?.step ?? null;

/** Changes one cell: its rule, owner team or lead time. Turning a skipped cell on takes the row's step as a start. */
export function setCell(table: StepsTable, rowKey: string, path: string, patch: { rule?: CellRule; role?: string; deadline?: { amount: number; unit: DeadlineUnit } | null }): StepsTable {
  const next = copy(table);
  const row = next.rows.find((item) => item.key === rowKey);
  if (!row || !row.cells[path]) return table;
  const cell = row.cells[path];
  const base: FlowStep = cell.step ?? someStep(row) ?? { key: row.key, name: row.name, role: checkMeta(row.check).role, check: row.check, column: row.column };
  const step: FlowStep = { ...base };
  if (patch.role !== undefined) step.role = patch.role;
  if (patch.deadline === null) delete step.deadline;
  else if (patch.deadline) step.deadline = { ...patch.deadline };
  row.cells[path] = { rule: patch.rule ?? (cell.rule === "skipped" && (patch.role || patch.deadline) ? "required" : cell.rule), step };
  return next;
}

/** Makes every path the same as this one ("Same on every path"). */
export function sameOnEveryPath(table: StepsTable, rowKey: string, path: string): StepsTable {
  const next = copy(table);
  const row = next.rows.find((item) => item.key === rowKey);
  const source = row?.cells[path];
  if (!row || !source) return table;
  for (const other of next.paths) row.cells[other] = structuredClone(source);
  return next;
}

/** Renames a row (the cells that had its name follow), or changes its stage, check or design stage. */
export function updateRow(table: StepsTable, rowKey: string, patch: { name?: string; column?: string; check?: FlowCheck; designStage?: DesignStage }): StepsTable {
  const next = copy(table);
  const row = next.rows.find((item) => item.key === rowKey);
  if (!row) return table;
  if (patch.name !== undefined) {
    for (const cell of Object.values(row.cells)) if (cell.step && cell.step.name === row.name) cell.step.name = patch.name;
    row.name = patch.name;
  }
  if (patch.column) row.column = patch.column;
  if (patch.check && patch.check !== row.check) {
    row.check = patch.check;
    const meta = checkMeta(patch.check);
    if (meta.designStage) row.designStage = meta.designStage; else delete row.designStage;
    if (meta.needs) row.needs = [...meta.needs]; else delete row.needs;
  }
  if (patch.designStage && row.check === "design_stage_done") row.designStage = patch.designStage;
  return next;
}

/** A new row for a catalogue check, required on every path, before the payment proof (or after `afterKey`). */
export function addRow(table: StepsTable, input: { check: FlowCheck; name: string; column: string; afterKey?: string | null; designStage?: DesignStage }): { table: StepsTable; key: string } {
  const next = copy(table);
  const taken = new Set(next.rows.flatMap((row) => [row.key, ...Object.values(row.cells).flatMap((cell) => cell.step ? [cell.step.key] : [])]));
  const root = (input.check === "design_stage_done" ? (input.designStage ?? "design_stage") : input.check.replace(/_(completed|recorded|chosen|confirmed|attached|approved|exists|set|logged|complete|done|sent|verified|signed_off)$/, ""))
    .replace(/[^a-z0-9_]+/g, "_").slice(0, 34) || "step";
  let key = root;
  for (let index = 2; taken.has(key); index += 1) key = `${root}_${index}`;
  const meta = checkMeta(input.check);
  const designStage = input.check === "design_stage_done" ? input.designStage ?? meta.designStage : undefined;
  const step: FlowStep = cleanStep({ key, name: input.name, role: meta.role, check: input.check, column: input.column, ...(designStage ? { designStage } : {}), ...(meta.needs ? { needs: [...meta.needs] } : {}) });
  const row: StepRow = { ...rowFrom(step, next.paths, () => true), key };
  const after = input.afterKey ? next.rows.findIndex((item) => item.key === input.afterKey) : -1;
  let at = after >= 0 ? after + 1 : next.rows.length;
  if (at >= next.rows.length && next.rows.length && isProof(next.rows.at(-1)!)) at = next.rows.length - 1;
  next.rows.splice(at, 0, row);
  return { table: next, key };
}

export const canRemoveRow = (table: StepsTable, rowKey: string) => {
  const row = table.rows.find((item) => item.key === rowKey);
  return Boolean(row) && !(isProof(row!) && table.rows.at(-1)?.key === rowKey);
};
export function removeRow(table: StepsTable, rowKey: string): StepsTable {
  if (!canRemoveRow(table, rowKey)) return table;
  return { ...copy(table), rows: table.rows.filter((row) => row.key !== rowKey).map((row) => structuredClone(row)) };
}

/** Moves a row one place up or down; the payment proof stays last. */
export function moveRow(table: StepsTable, rowKey: string, direction: -1 | 1): StepsTable {
  const index = table.rows.findIndex((row) => row.key === rowKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= table.rows.length) return table;
  const last = table.rows.length - 1;
  if (isProof(table.rows[last]) && (index === last || target === last)) return table;
  const next = copy(table);
  [next.rows[index], next.rows[target]] = [next.rows[target], next.rows[index]];
  return next;
}

/**
 * Splits the steps by another path question, or none. Going from one column to paths copies each step to every
 * path; going back (or to another question) is only possible while every step is the same on every path.
 */
export function canChangeQuestion(table: StepsTable) {
  return !table.question || table.rows.every((row) => isUniform(table, row));
}
export function setQuestion(table: StepsTable, question: BranchQuestion | null, options: AnswerOptions = {}): StepsTable {
  if (question === table.question || !canChangeQuestion(table)) return table;
  const paths = question ? orderedPaths(question, options, question === "subPath" ? [] : answerOptions(question, options).map((option) => option.value)) : [ALL_PATHS];
  if (question && !paths.length) return table;
  return {
    question, paths, branchKeys: table.branchKeys,
    rows: table.rows.map((row) => {
      const cell = row.cells[table.paths[0]];
      return { ...structuredClone(row), cells: Object.fromEntries(paths.map((path) => [path, structuredClone(cell)])) };
    }),
  };
}

/** The pipeline stages, in order, each with its rows (CeCe's "stage" rows). */
export function rowsByStage(table: StepsTable): Array<{ column: string; rows: StepRow[] }> {
  const groups: Array<{ column: string; rows: StepRow[] }> = [];
  for (const row of table.rows) {
    const last = groups.at(-1);
    if (last && last.column === row.column) last.rows.push(row);
    else groups.push({ column: row.column, rows: [row] });
  }
  return groups;
}
