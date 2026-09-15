import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProjectData,
  ProjectRole,
} from "./execution.types";

export const PROJECT_WORKFLOW_PHASES = [
  "planning",
  "active",
  "handover",
  "completed",
] as const;

export type ProjectWorkflowPhase = (typeof PROJECT_WORKFLOW_PHASES)[number];

export const PROJECT_WORKFLOW_GATE_KEYS = [
  "project_manager_assigned",
  "tasks_planned",
  "all_tasks_closed",
  "all_snags_closed",
  "all_handovers_accepted",
  "finance_closed",
] as const;

export type ProjectWorkflowGateKey =
  (typeof PROJECT_WORKFLOW_GATE_KEYS)[number];

const PROJECT_ROLES: readonly ProjectRole[] = [
  "sales_manager",
  "senior_designer",
  "junior_designer",
  "technical_designer",
  "visualizer",
  "project_manager",
  "creative_director",
  "finance",
  "procurement_production",
  "crm_owner",
  "sales_assistant",
  "surveyor",
];

export type ProjectWorkflowStage = {
  key: string;
  visibleName: string;
  description: string;
  phase: ProjectWorkflowPhase;
  ownerRole: ProjectRole | null;
  exitGates: ProjectWorkflowGateKey[];
};

export type ProjectWorkflowTemplateInput = {
  version: number;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  stages: ProjectWorkflowStage[];
};

export type ProjectWorkflowTemplate = ProjectWorkflowTemplateInput & {
  id: string | null;
  status: "active" | "archived";
  source: "built_in" | "workspace";
  updatedAt: Date | string | null;
};

export type ProjectWorkflowGateResult = {
  key: ProjectWorkflowGateKey;
  passed: boolean;
};

export type ProjectWorkflowHistoryEntry = {
  id: string;
  action: "adopted" | "advanced" | "returned" | "completed" | "reopened";
  fromStageKey: string | null;
  toStageKey: string;
  at: string;
  byId: string;
  byName: string;
  note: string;
  gateResults: ProjectWorkflowGateResult[];
};

export type ProjectWorkflowState = {
  template: {
    id: string | null;
    code: string;
    name: string;
    version: number;
    source: "built_in" | "workspace";
    stages: ProjectWorkflowStage[];
  };
  currentStageKey: string;
  currentStageStartedAt: string;
  history: ProjectWorkflowHistoryEntry[];
};

export const DEFAULT_PROJECT_WORKFLOW_STAGES: readonly ProjectWorkflowStage[] = [
  {
    key: "planning",
    visibleName: "Planning",
    description: "Confirm ownership and turn the released scope into executable work.",
    phase: "planning",
    ownerRole: "project_manager",
    exitGates: ["project_manager_assigned", "tasks_planned"],
  },
  {
    key: "delivery",
    visibleName: "Delivery",
    description: "Coordinate design, sourcing, production and site work as overlapping work packages.",
    phase: "active",
    ownerRole: "project_manager",
    exitGates: ["all_tasks_closed", "all_snags_closed"],
  },
  {
    key: "handover",
    visibleName: "Handover",
    description: "Complete client acceptance and financial reconciliation.",
    phase: "handover",
    ownerRole: "project_manager",
    exitGates: ["all_handovers_accepted", "finance_closed"],
  },
  {
    key: "completed",
    visibleName: "Completed",
    description: "Keep the closed project available as an auditable record.",
    phase: "completed",
    ownerRole: null,
    exitGates: [],
  },
];

export function builtInProjectWorkflow(): ProjectWorkflowTemplate {
  return {
    id: null,
    version: 0,
    code: "standard_delivery",
    name: "Standard project delivery",
    description:
      "A neutral project lifecycle. Detailed work packages can overlap inside Delivery.",
    isDefault: true,
    status: "active",
    source: "built_in",
    updatedAt: null,
    stages: DEFAULT_PROJECT_WORKFLOW_STAGES.map((stage) => ({
      ...stage,
      exitGates: [...stage.exitGates],
    })),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  required = true,
): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string")
    throw new BadRequestException(`${label} is invalid.`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result))
    throw new BadRequestException(`${label} is invalid.`);
  return result;
}

function slug(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(result))
    throw new BadRequestException(
      `${label} must start with a letter and use lowercase letters, numbers or underscores.`,
    );
  return result;
}

function member<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T))
    throw new BadRequestException(`${label} is invalid.`);
  return value as T;
}

export function parseProjectWorkflowTemplate(
  input: unknown,
): ProjectWorkflowTemplateInput {
  const value = object(input, "Workflow template");
  if (!Number.isInteger(value.version) || Number(value.version) < 0)
    throw new BadRequestException("Workflow template version is invalid.");
  if (typeof value.isDefault !== "boolean")
    throw new BadRequestException("Choose whether this is the default workflow.");
  if (!Array.isArray(value.stages) || value.stages.length < 2 || value.stages.length > 12)
    throw new BadRequestException("Add between 2 and 12 workflow stages.");

  const stages = value.stages.map((entry, index): ProjectWorkflowStage => {
    const stage = object(entry, `Workflow stage ${index + 1}`);
    const ownerRole =
      stage.ownerRole === null || stage.ownerRole === ""
        ? null
        : member(stage.ownerRole, PROJECT_ROLES, `Workflow stage ${index + 1} owner role`);
    if (!Array.isArray(stage.exitGates) || stage.exitGates.length > PROJECT_WORKFLOW_GATE_KEYS.length)
      throw new BadRequestException(`Workflow stage ${index + 1} gates are invalid.`);
    const exitGates = stage.exitGates.map((gate) =>
      member(gate, PROJECT_WORKFLOW_GATE_KEYS, `Workflow stage ${index + 1} gate`),
    );
    if (new Set(exitGates).size !== exitGates.length)
      throw new BadRequestException(`Workflow stage ${index + 1} repeats a gate.`);
    return {
      key: slug(stage.key, `Workflow stage ${index + 1} key`),
      visibleName: text(stage.visibleName, `Workflow stage ${index + 1} name`, 80),
      description: text(
        stage.description,
        `Workflow stage ${index + 1} description`,
        500,
        false,
      ),
      phase: member(stage.phase, PROJECT_WORKFLOW_PHASES, `Workflow stage ${index + 1} phase`),
      ownerRole,
      exitGates,
    };
  });

  if (new Set(stages.map((stage) => stage.key)).size !== stages.length)
    throw new BadRequestException("Every workflow stage needs a unique key.");
  const phaseIndex = (phase: ProjectWorkflowPhase) => PROJECT_WORKFLOW_PHASES.indexOf(phase);
  if (stages[0].phase !== "planning" || stages.at(-1)?.phase !== "completed")
    throw new BadRequestException(
      "A workflow must start in Planning and finish in Completed.",
    );
  if (stages.slice(0, -1).some((stage) => stage.phase === "completed"))
    throw new BadRequestException("Only the final workflow stage can be Completed.");
  if (stages.some((stage, index) => index > 0 && phaseIndex(stage.phase) < phaseIndex(stages[index - 1].phase)))
    throw new BadRequestException("Workflow phases must move forward.");
  if (stages.at(-1)!.exitGates.length)
    throw new BadRequestException("The Completed stage cannot have exit gates.");

  return {
    version: Number(value.version),
    code: slug(value.code, "Workflow template code"),
    name: text(value.name, "Workflow template name", 120),
    description: text(value.description, "Workflow template description", 1000, false),
    isDefault: value.isDefault,
    stages,
  };
}

export function parseWorkflowVersion(input: unknown): number {
  const value = object(input, "Workflow template request").version;
  if (!Number.isInteger(value) || Number(value) < 1)
    throw new BadRequestException("Workflow template version is invalid.");
  return Number(value);
}

function frozenTemplate(template: ProjectWorkflowTemplate) {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    version: template.version,
    source: template.source,
    stages: template.stages.map((stage) => ({
      ...stage,
      exitGates: [...stage.exitGates],
    })),
  };
}

function historyEntry(
  action: ProjectWorkflowHistoryEntry["action"],
  fromStageKey: string | null,
  toStageKey: string,
  at: string,
  byId: string,
  byName: string,
  note: string,
  gateResults: ProjectWorkflowGateResult[] = [],
): ProjectWorkflowHistoryEntry {
  return {
    id: randomUUID(),
    action,
    fromStageKey,
    toStageKey,
    at,
    byId,
    byName,
    note,
    gateResults,
  };
}

export function adoptProjectWorkflow(
  template: ProjectWorkflowTemplate,
  at: string,
  byId: string,
  byName: string,
): ProjectWorkflowState {
  const selected = frozenTemplate(template);
  const first = selected.stages[0];
  return {
    template: selected,
    currentStageKey: first.key,
    currentStageStartedAt: at,
    history: [
      historyEntry(
        "adopted",
        null,
        first.key,
        at,
        byId,
        byName,
        `Adopted ${selected.name} version ${selected.version}.`,
      ),
    ],
  };
}

export function ensureProjectWorkflow(data: ProjectData): ProjectWorkflowState {
  if (data.workflow) return data.workflow;
  const template = builtInProjectWorkflow();
  const workflow = adoptProjectWorkflow(template, "", "", "System migration");
  const phaseIndex = PROJECT_WORKFLOW_PHASES.indexOf(data.phase);
  const matching = [...workflow.template.stages]
    .reverse()
    .find(
      (stage) =>
        PROJECT_WORKFLOW_PHASES.indexOf(stage.phase) <= phaseIndex,
    );
  if (matching) {
    workflow.currentStageKey = matching.key;
    workflow.history[0].toStageKey = matching.key;
  }
  data.workflow = workflow;
  return workflow;
}

export function projectWorkflowGateResults(
  data: ProjectData,
  stage: ProjectWorkflowStage,
): ProjectWorkflowGateResult[] {
  return stage.exitGates.map((key) => {
    let passed = false;
    if (key === "project_manager_assigned")
      passed = Boolean(
        data.roleAssignments?.some(
          (assignment) =>
            assignment.role === "project_manager" && assignment.memberId,
        ),
      );
    else if (key === "tasks_planned")
      passed = data.tasks.some(
        (task) =>
          task.status !== "cancelled" &&
          Boolean(task.ownerId && task.start && task.end),
      );
    else if (key === "all_tasks_closed")
      passed =
        data.tasks.length > 0 &&
        data.tasks.every((task) =>
          ["completed", "cancelled"].includes(task.status),
        );
    else if (key === "all_snags_closed")
      passed = data.snags.every((snag) => snag.status === "closed");
    else if (key === "all_handovers_accepted")
      passed =
        data.handovers.length > 0 &&
        data.handovers.every((handover) => handover.status === "accepted");
    else if (key === "finance_closed") passed = data.financeClosed;
    return { key, passed };
  });
}

export function projectWorkflowSummary(data: ProjectData) {
  const workflow = ensureProjectWorkflow(data);
  const current = currentStage(workflow);
  const next = workflow.template.stages[current.index + 1] ?? null;
  const ownerId = current.stage.ownerRole
    ? (data.roleAssignments ?? []).find(
        (assignment) => assignment.role === current.stage.ownerRole,
      )?.memberId ?? null
    : null;
  return {
    templateId: workflow.template.id,
    templateCode: workflow.template.code,
    templateVersion: workflow.template.version,
    currentStageKey: current.stage.key,
    currentStageName: current.stage.visibleName,
    currentStageStartedAt: workflow.currentStageStartedAt || null,
    ownerRole: current.stage.ownerRole,
    ownerId,
    nextStage: next ? { key: next.key, name: next.visibleName } : null,
    exitGates: projectWorkflowGateResults(data, current.stage),
  };
}

function currentStage(workflow: ProjectWorkflowState) {
  const index = workflow.template.stages.findIndex(
    (stage) => stage.key === workflow.currentStageKey,
  );
  if (index < 0)
    throw new ConflictException(
      "The frozen project workflow is invalid. Review the project before continuing.",
    );
  return { index, stage: workflow.template.stages[index] };
}

function transitionNote(value: unknown, required: boolean): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string")
    throw new BadRequestException("Workflow transition note is invalid.");
  const note = value.trim();
  if ((required && !note) || note.length > 3000)
    throw new BadRequestException(
      required
        ? "Record why the project is returning to an earlier stage."
        : "Workflow transition note is too long.",
    );
  return note;
}

function assertPassed(results: ProjectWorkflowGateResult[]) {
  const failed = results.filter((result) => !result.passed);
  if (failed.length)
    throw new ConflictException(
      `Complete the current stage gates first: ${failed
        .map((result) => result.key)
        .join(", ")}.`,
    );
}

function assertStageOwner(data: ProjectData, stage: ProjectWorkflowStage) {
  if (
    stage.ownerRole &&
    !data.roleAssignments?.some(
      (assignment) =>
        assignment.role === stage.ownerRole && assignment.memberId,
    )
  )
    throw new ConflictException(
      `Assign the ${stage.ownerRole} role before leaving ${stage.visibleName}.`,
    );
}

export function transitionProjectWorkflow(
  data: ProjectData,
  toStageKey: unknown,
  noteValue: unknown,
  actor: { id: string; name: string; now: string },
): string {
  const workflow = ensureProjectWorkflow(data);
  if (typeof toStageKey !== "string" || !toStageKey.trim())
    throw new BadRequestException("Choose the next project stage.");
  const targetIndex = workflow.template.stages.findIndex(
    (stage) => stage.key === toStageKey.trim(),
  );
  if (targetIndex < 0)
    throw new BadRequestException("Choose a stage from this project's frozen workflow.");
  const current = currentStage(workflow);
  if (targetIndex === current.index)
    throw new ConflictException("The project is already in this stage.");
  if (targetIndex === workflow.template.stages.length - 1)
    throw new ConflictException(
      "Use project completion so all closeout controls are checked.",
    );

  const movingForward = targetIndex > current.index;
  if (movingForward && targetIndex !== current.index + 1)
    throw new ConflictException("Move through one project stage at a time.");
  if (movingForward && data.controls?.onHold)
    throw new ConflictException(
      `Release the project hold before moving forward${
        data.controls.holdReason ? `: ${data.controls.holdReason}` : "."
      }`,
    );
  const target = workflow.template.stages[targetIndex];
  if (
    movingForward &&
    PROJECT_WORKFLOW_PHASES.indexOf(target.phase) >
      PROJECT_WORKFLOW_PHASES.indexOf(data.phase)
  )
    throw new ConflictException(
      `Complete the project's ${target.phase} operational controls before entering this stage.`,
    );
  const note = transitionNote(noteValue, !movingForward);
  const gateResults = movingForward
    ? projectWorkflowGateResults(data, current.stage)
    : [];
  if (movingForward) {
    assertStageOwner(data, current.stage);
    assertPassed(gateResults);
  }
  const entry = historyEntry(
    movingForward ? "advanced" : "returned",
    current.stage.key,
    target.key,
    actor.now,
    actor.id,
    actor.name,
    note,
    gateResults,
  );
  workflow.currentStageKey = target.key;
  workflow.currentStageStartedAt = actor.now;
  workflow.history.push(entry);
  return entry.id;
}

export function completeProjectWorkflow(
  data: ProjectData,
  noteValue: unknown,
  actor: { id: string; name: string; now: string },
): string {
  const workflow = ensureProjectWorkflow(data);
  const current = currentStage(workflow);
  const finalIndex = workflow.template.stages.length - 1;
  if (data.controls?.onHold)
    throw new ConflictException("Release the project hold before completion.");
  const seen = new Set<ProjectWorkflowGateKey>();
  const gateResults = workflow.template.stages
    .slice(current.index, finalIndex)
    .flatMap((stage) => projectWorkflowGateResults(data, stage))
    .filter((result) => {
      if (seen.has(result.key)) return false;
      seen.add(result.key);
      return true;
    });
  const final = workflow.template.stages[finalIndex];
  const entry = historyEntry(
    "completed",
    current.stage.key,
    final.key,
    actor.now,
    actor.id,
    actor.name,
    transitionNote(noteValue, false),
    gateResults,
  );
  workflow.currentStageKey = final.key;
  workflow.currentStageStartedAt = actor.now;
  workflow.history.push(entry);
  return entry.id;
}

export function reopenProjectWorkflow(
  data: ProjectData,
  noteValue: unknown,
  actor: { id: string; name: string; now: string },
): string {
  const workflow = ensureProjectWorkflow(data);
  const current = currentStage(workflow);
  const target = workflow.template.stages[Math.max(0, current.index - 1)];
  const entry = historyEntry(
    "reopened",
    current.stage.key,
    target.key,
    actor.now,
    actor.id,
    actor.name,
    transitionNote(noteValue, true),
  );
  workflow.currentStageKey = target.key;
  workflow.currentStageStartedAt = actor.now;
  workflow.history.push(entry);
  return entry.id;
}
