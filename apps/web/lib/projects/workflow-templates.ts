export type ProjectWorkflowPhase = "planning" | "active" | "handover" | "completed";

export type ProjectWorkflowGate =
  | "project_manager_assigned"
  | "tasks_planned"
  | "production_plan_ready"
  | "all_tasks_closed"
  | "all_snags_closed"
  | "all_handovers_accepted"
  | "finance_closed";

export type ProjectWorkflowRole =
  | "sales_manager"
  | "senior_designer"
  | "junior_designer"
  | "technical_designer"
  | "visualizer"
  | "project_manager"
  | "creative_director"
  | "finance"
  | "procurement_production"
  | "crm_owner"
  | "sales_assistant"
  | "surveyor";

export type ProjectWorkflowStage = {
  key: string;
  visibleName: string;
  description: string;
  phase: ProjectWorkflowPhase;
  ownerRole: ProjectWorkflowRole | null;
  exitGates: ProjectWorkflowGate[];
  releaseStart?: boolean;
};

export type ProjectWorkflowTemplate = {
  id: string | null;
  version: number;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  status: "active" | "archived";
  source: "built_in" | "workspace";
  updatedAt: string | null;
  stages: ProjectWorkflowStage[];
};

export type ProjectWorkflowTemplatesResponse = {
  defaultTemplate: ProjectWorkflowTemplate;
  templates: ProjectWorkflowTemplate[];
  supportedExitGates: ProjectWorkflowGate[];
};
