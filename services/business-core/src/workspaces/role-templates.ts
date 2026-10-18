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
  "crm.notifications.view", "crm.reports.view", "crm.leads.view_all",
] as const;

/**
 * §0.3 P0: an account manager works their own enquiries (no assigning, no one else's records). Guide A: the inbox is the
 * Sales Admin team's (and the owner's); an account manager talks to clients in the chats of their own jobs.
 */
const ACCOUNT_MANAGER = CRM_DAY_TO_DAY.filter((code) => code !== "crm.leads.assign" && code !== "crm.leads.view_all" && code !== "crm.communications.view");

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
  // §0.3 P0: the seats a design firm's sales and design teams fill. Labels are the firm's to change (Setup → Seats).
  {
    code: "account_manager",
    name: "Account manager",
    description: "Works their own enquiries and opportunities from first contact to the deal; never sees internal costs or anyone else's records",
    permissions: [...ACCOUNT_MANAGER, "pre_projects.view", "pre_projects.create", "pre_projects.edit", "catalog.view", "portal.contacts.manage", "commercial.record_decision", "finance_requests.raise"],
  },
  {
    code: "sales_admin",
    name: "Sales admin",
    description: "Receives and assigns every enquiry, keeps client details right and supports the account managers; no access to Settings",
    // Guide A: the Sales Admin team works the inbox (its queue, closing messages after a confirmation).
    permissions: [...CRM_DAY_TO_DAY, "crm.inbox.team", "crm.inbox.close_chats", "crm.parties.identity", "pre_projects.view", "pre_projects.edit", "catalog.view", "reminders.team"],
  },
  {
    code: "designer",
    name: "Interior designer",
    description: "Designs the job: site measure, drawings, the client's design decisions and progress reports",
    permissions: ["pre_projects.view", "pre_projects.edit", "pre_projects.verify_measurements", "pre_projects.record_client_design_decisions",
      "crm.activities.view", "crm.activities.manage", "projects.view", "projects.report", "catalog.view"],
  },
  {
    code: "creative_director",
    name: "Creative director",
    description: "Reviews and approves designs before the client sees them",
    permissions: ["pre_projects.view", "pre_projects.review_designs", "projects.view", "catalog.view"],
  },
  {
    code: "visualiser",
    name: "Visualiser",
    description: "Makes the renders for the jobs they are given",
    permissions: ["pre_projects.view", "projects.view", "projects.report", "catalog.view"],
  },
  {
    code: "material_coordinator",
    name: "Material coordinator",
    description: "Keeps the material log and the sample library, and sources what the designs need",
    permissions: ["pre_projects.view", "pre_projects.manage_materials", "catalog.samples.manage", "projects.view", "catalog.view", "vendors.view", "stock.view"],
  },
  {
    code: "technical_lead",
    name: "Technical lead",
    description: "Leads the technical drawings for production, item by item",
    permissions: ["pre_projects.view", "projects.view", "projects.report", "catalog.view"],
  },
  {
    code: "marketing",
    name: "Marketing",
    description: "Reads the sales reports and the catalogue",
    permissions: ["catalog.view", "crm.reports.view"],
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
      // Woddy reads a supplier bill's photo into a draft invoice (bill capture is Finance's): reading is an AI suggestion (0299).
      "ai.suggestions.use",
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

/** §0.3 P0: the design firm seats come only with a kit that lists them, never with the "every template" default. */
export const OPT_IN_ROLE_TEMPLATES: ReadonlySet<string> = new Set(["account_manager", "sales_admin", "designer", "creative_director", "visualiser", "material_coordinator", "technical_lead", "marketing"]);

/**
 * The template codes a kit configuration asks for. A kit without `roleTemplates` gets every
 * template but the opt-in seats; an unknown or malformed entry is a configuration error, never silently skipped.
 */
export function parseRoleTemplateCodes(value: unknown): string[] {
  if (value === undefined || value === null) return ROLE_TEMPLATE_CODES.filter((code) => !OPT_IN_ROLE_TEMPLATES.has(code));
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
