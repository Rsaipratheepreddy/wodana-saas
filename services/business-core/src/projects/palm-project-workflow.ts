import { palmFlowRoute, type PalmFlowScope, type PalmFlowStage } from "./palm-flow-route";
import type { ProjectWorkflowStage, ProjectWorkflowTemplate } from "./project-workflow";

const stageLabels: Partial<Record<PalmFlowStage, [string, ProjectWorkflowStage["ownerRole"]]>> = {
  site_visit: ["Site visit & scope", null],
  design_specifications: ["Design & specifications", "senior_designer"],
  main_quote: ["Main quotation", "sales_manager"],
  main_qs_review: ["QS estimate", "surveyor"],
  main_client_approval: ["Client approval", "sales_manager"],
  main_agreement_payment: ["Agreement & payment", "finance"],
  material_list_signoff: ["Material list sign-off", "senior_designer"],
  procurement: ["Procurement", "procurement_production"],
  manufacturing_readiness: ["Manufacturing readiness", "procurement_production"],
  factory_production: ["Factory production", "procurement_production"],
  site_works: ["Site works", "project_manager"],
  installation: ["Installation", "project_manager"],
  snagging: ["Snagging", "project_manager"],
  client_handover: ["Client handover", "project_manager"],
};

/** Freeze only applicable stages for this Deal, keeping the workspace template unchanged. */
export function palmProjectWorkflowTemplate(
  template: ProjectWorkflowTemplate,
  scope: PalmFlowScope,
): ProjectWorkflowTemplate {
  const route = palmFlowRoute(scope);
  const stages: ProjectWorkflowStage[] = [
    {
      key: "deal_file", visibleName: "Deal File", description: "One approved Deal and Project Ref.",
      phase: "planning", ownerRole: null, exitGates: [],
    },
    ...route.project.filter((key) => key !== "client_handover").map((key): ProjectWorkflowStage => {
      const [visibleName, ownerRole] = stageLabels[key]!;
      return {
        key, visibleName, description: "", ownerRole,
        phase: key === "snagging" ? "handover" : "active",
        exitGates: key === "manufacturing_readiness" ? ["production_plan_ready"]
          : key === "site_visit" ? ["site_visit_recorded"]
          : key === "snagging" ? ["all_tasks_closed", "all_snags_closed", "all_handovers_accepted", "finance_closed"]
          : [],
        ...(key === "procurement" ? { releaseStart: true } : {}),
      };
    }),
    {
      key: "completed", visibleName: scope.mainQuotation ? "Client handover" : "Design complete",
      description: "Keep signed-off work and decisions available as one project record.",
      phase: "completed", ownerRole: null, exitGates: [],
    },
  ];
  return {
    ...template,
    code: "palm_design_build_delivery",
    name: "Palm Living project",
    description: "The selected enquiry path, with one Deal and only applicable delivery stages.",
    stages,
  };
}
