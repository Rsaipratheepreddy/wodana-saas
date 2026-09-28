import { BadRequestException } from "@nestjs/common";

/**
 * A role a firm setup kit gives a new workspace: the people a firm of that kind employs, with the
 * permissions they need on day one. Templates are materialised as editable (non-system) roles, so
 * a workspace can tune or delete them. The kit lists which templates apply (`roleTemplates`); a kit
 * without the key gets all of them.
 */
export type RoleTemplate = {
  code: string;
  name: string;
  description: string;
  permissions: readonly string[];
};

const CRM_DAY_TO_DAY = [
  "crm.leads.view", "crm.leads.manage", "crm.leads.assign",
  "crm.parties.view", "crm.parties.manage",
  "crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.transition", "crm.opportunities.sensitive_values",
  "crm.activities.view", "crm.activities.manage",
  "crm.communications.view", "crm.communications.send",
  "crm.notifications.view", "crm.reports.view",
] as const;

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: "sales",
    name: "Sales",
    description: "Handles enquiries, follow-ups, the pipeline, planning cases and quotes; never sees internal costs",
    permissions: [...CRM_DAY_TO_DAY, "pre_projects.view", "pre_projects.create", "pre_projects.edit", "catalog.view"],
  },
  {
    code: "quantity_surveyor",
    name: "Quantity Surveyor",
    description: "Estimator: reviews quotation costs and approves the estimate before the client receives a proposal",
    permissions: ["pre_projects.view", "crm.opportunities.view", "commercial.costs.view", "commercial.estimate"],
  },
  {
    code: "finance_reviewer",
    name: "Finance reviewer",
    description: "Verifies deal payment evidence and confirms final commissions before operations approval",
    // Reads Finance (supplier bills and client invoices) to verify what came in and what is owed.
    permissions: ["pre_projects.view", "crm.opportunities.view", "commercial.finance.verify", "payables.view", "receivables.view"],
  },
  {
    code: "operations_approver",
    name: "Operations approver",
    description: "Approves Finance-verified deals and authorizes their release to production",
    permissions: ["pre_projects.view", "crm.opportunities.view", "commercial.deal.approve", "commercial.release"],
  },
  {
    code: "project_manager",
    name: "Project manager",
    description: "Runs delivery projects: sites, assignments, schedule, progress reviews and what still needs ordering",
    permissions: [
      "projects.view", "projects.manage", "projects.report", "projects.review", "projects.costs.view",
      "projects.schedule.view", "projects.schedule.manage", "jobs.stage.manage",
      "pre_projects.view", "crm.opportunities.view", "catalog.view",
      "purchasing.view", "stock.view", "vendors.view", "hrms.team",
    ],
  },
  {
    code: "site_supervisor",
    name: "Site supervisor",
    description: "On site: reports progress, receives and inspects deliveries and keeps the team's attendance",
    permissions: [
      "projects.view", "projects.report", "projects.schedule.view",
      "stock.view", "stock.receive", "stock.inspect", "catalog.view",
      "hrms.self", "hrms.team",
    ],
  },
];

export const ROLE_TEMPLATE_CODES: readonly string[] = ROLE_TEMPLATES.map((template) => template.code);

/**
 * The template codes a kit configuration asks for. A kit without `roleTemplates` gets every
 * template; an unknown or malformed entry is a configuration error, never silently skipped.
 */
export function parseRoleTemplateCodes(value: unknown): string[] {
  if (value === undefined || value === null) return [...ROLE_TEMPLATE_CODES];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new BadRequestException("The firm kit's roleTemplates must be a list of role template codes");
  }
  const codes = [...new Set(value as string[])];
  const unknown = codes.filter((code) => !ROLE_TEMPLATE_CODES.includes(code));
  if (unknown.length) throw new BadRequestException(`Unknown role template: ${unknown.join(", ")}`);
  return codes;
}

export function roleTemplatesFor(codes: readonly string[]): RoleTemplate[] {
  return ROLE_TEMPLATES.filter((template) => codes.includes(template.code));
}
