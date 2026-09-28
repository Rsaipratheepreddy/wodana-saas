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
    description: "Handles enquiries, follow-ups, the pipeline, planning cases and quotes, and sends quotes to the client; never sees internal costs",
    // Sends its own quotes: names the client's decision-maker on the case (portal.contacts.manage).
    permissions: [...CRM_DAY_TO_DAY, "pre_projects.view", "pre_projects.create", "pre_projects.edit", "catalog.view", "portal.contacts.manage"],
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
    code: "finance",
    name: "Finance",
    description: "Enters supplier bills and client invoices, records payments and petty cash, and verifies client receipts and deals",
    permissions: [
      "pre_projects.view", "crm.opportunities.view", "projects.view", "commercial.costs.view", "commercial.finance.verify",
      "payables.view", "payables.manage", "receivables.view", "receivables.manage", "accounting.manage",
    ],
  },
  {
    code: "finance_approver",
    name: "Finance approver",
    description: "Approves held supplier bills and payment runs that someone else prepared",
    permissions: ["projects.view", "payables.view", "payables.approve", "receivables.view"],
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
      "projects.view", "projects.manage", "projects.report", "projects.review",
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
  {
    code: "buyer",
    name: "Buyer",
    description: "Raises purchase orders, chases suppliers and receives what arrives; someone else approves the orders",
    permissions: [
      "projects.view", "projects.buy", "catalog.view", "purchasing.view", "purchasing.manage",
      "vendors.view", "vendors.manage", "supplier_offers.view", "supplier_offers.manage", "stock.view", "stock.receive",
    ],
  },
  {
    code: "purchasing_approver",
    name: "Purchasing approver",
    description: "Approves purchase orders, new suppliers, stock corrections and orders beyond a project's money in hand",
    permissions: [
      "projects.view", "purchasing.view", "purchasing.approve", "vendors.view", "vendors.approve",
      "stock.view", "stock.adjust", "projects.funds_override",
    ],
  },
  {
    code: "factory_lead",
    name: "Factory lead",
    description: "Plans and releases factory work, reports output and approves what the team made",
    permissions: [
      "projects.view", "projects.schedule.view", "catalog.view", "stock.view",
      "factory.view", "factory.manage", "factory.report", "factory.approve",
    ],
  },
  {
    code: "qc_inspector",
    name: "QC inspector",
    description: "Checks factory output and incoming goods before they are accepted",
    permissions: ["projects.view", "factory.view", "factory.approve", "stock.view", "stock.inspect"],
  },
  {
    code: "storekeeper",
    name: "Storekeeper",
    description: "Receives, moves and counts stock; corrections go to an approver",
    permissions: ["projects.view", "catalog.view", "purchasing.view", "stock.view", "stock.manage", "stock.receive", "stock.inspect"],
  },
];

/**
 * The permissions that approve someone else's work, each with the words the Roles page uses when
 * only one active person holds it (nobody can cover them, and they can't approve their own work).
 */
export const APPROVAL_PERMISSIONS: readonly string[] = [
  "commercial.estimate", "commercial.approve", "commercial.finance.verify", "commercial.deal.approve",
  "purchasing.approve", "vendors.approve", "stock.adjust", "factory.approve", "payables.approve", "projects.review",
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
