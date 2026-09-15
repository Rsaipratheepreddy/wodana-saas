import { BadRequestException } from "@nestjs/common";
import type { ProjectRole } from "./execution.types";

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
