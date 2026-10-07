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
    // Sends its own quotes: names the client's decision-maker on the case (portal.contacts.manage), not the portal.
    // Records a client's decision given outside the portal, with the file it came in (commercial.record_decision, Q-24).
    // Asks Finance for invoices and refunds from the client, deal or project (finance_requests.raise, PLM-107).
    permissions: [...CRM_DAY_TO_DAY, "pre_projects.view", "pre_projects.create", "pre_projects.edit", "catalog.view", "portal.contacts.manage", "commercial.record_decision",
      "finance_requests.raise",
      // Assigns enquiries, so works the team's My day (0289).
      "reminders.team"],
  },
  {
    code: "quantity_surveyor",
    name: "Quantity Surveyor",
    description: "Estimator: reviews quotation costs and approves the estimate before the client receives a proposal",
    permissions: ["pre_projects.view", "crm.opportunities.view", "commercial.costs.view", "commercial.estimate", "finance_requests.raise"],
  },
  {
    code: "finance_reviewer",
    name: "Finance reviewer",
    description: "Verifies deal payment evidence and confirms final commissions before operations approval",
    // Reads Finance (supplier bills and client invoices) to verify what came in and what is owed.
    permissions: ["pre_projects.view", "crm.opportunities.view", "commercial.finance.verify", "payables.view", "receivables.view", "finance_requests.raise"],
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
      "purchasing.view", "stock.view", "vendors.view", "hrms.team", "finance_requests.raise",
      // Runs projects, so works the team's My day (0289).
      "reminders.team",
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
  // Delivery work beyond the Owner: someone buys, someone else approves, the store keeps and counts
  // stock, the factory lead runs and approves output, an inspector checks it. Separation of duties is
  // enforced by the commands (nobody approves an order, report or correction they raised).
  {
    code: "buyer",
    name: "Buyer",
    description: "Buys what projects need: price requests, orders to suppliers, confirmations and chasing late deliveries",
    permissions: ["projects.view", "purchasing.view", "purchasing.manage", "vendors.view", "vendors.manage", "stock.view", "stock.receive", "catalog.view", "finance_requests.raise"],
  },
  {
    code: "purchasing_approver",
    name: "Purchasing approver",
    description: "Approves the orders others raise, supplier alternatives and new suppliers",
    permissions: ["projects.view", "purchasing.view", "purchasing.approve", "vendors.view", "vendors.approve", "stock.view"],
  },
  {
    code: "storekeeper",
    name: "Storekeeper",
    description: "Receives deliveries, keeps stock by place, issues and moves it, and counts it",
    permissions: ["projects.view", "purchasing.view", "stock.view", "stock.manage", "stock.receive", "stock.adjust", "catalog.view"],
  },
  {
    code: "factory_lead",
    name: "Factory lead",
    description: "Plans and releases work orders, approves others' output and sends made goods to site",
    permissions: ["projects.view", "factory.view", "factory.manage", "factory.report", "factory.approve", "stock.view", "stock.manage", "purchasing.view", "catalog.view"],
  },
  {
    code: "qc_inspector",
    name: "QC inspector",
    description: "Checks factory output and inspects deliveries; never checks their own work",
    permissions: ["projects.view", "factory.view", "factory.approve", "stock.view", "stock.inspect", "purchasing.view"],
  },
  {
    code: "finance",
    name: "Finance",
    description: "Enters supplier invoices, records payments and client receipts, and verifies deal payments",
    permissions: [
      "pre_projects.view", "crm.opportunities.view", "commercial.finance.verify", "commercial.costs.view",
      "payables.view", "payables.manage", "receivables.view", "receivables.manage", "accounting.manage", "purchasing.view", "projects.view",
      // Works the Finance requests board (PLM-107).
      "finance_requests.raise", "finance_requests.manage",
      // Ledger: reads it and prepares manual journals; someone else approves them.
      "books.view", "books.post",
    ],
  },
  {
    code: "finance_approver",
    name: "Finance approver",
    description: "Approves held supplier invoices and payment runs that someone else prepared",
    permissions: ["payables.view", "payables.approve", "receivables.view", "purchasing.view", "projects.view", "books.view", "books.approve"],
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
