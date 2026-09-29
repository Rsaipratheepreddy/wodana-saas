/**
 * What each workspace destination needs, in the same permission codes the business service checks
 * for the page's main data. Navigation, tabs and direct links all read this map, so a person is
 * only offered places they can open. Owners and administrators can open everything.
 *
 * A rule is a list of groups: every group must be met, and a group is met by any one of its codes.
 * An empty rule means any member of the workspace.
 */
export type AccessRule = ReadonlyArray<ReadonlyArray<string>>;

export type AccessContext = { permissions?: readonly string[] | null; roles?: readonly string[] | null };

const ORGANIZATION_READ = ["module.organization.read", "legal_entities.view"];
const MEMBERS_READ = ["module.members.read", "module.members.write", "module.members.edit", "module.members.delete", "workspace.members.manage"];
const PROJECTS_VIEW = ["projects.view", "projects.manage"];
export const PURCHASING_VIEW = ["purchasing.view", "purchasing.manage", "vendors.view", "vendors.manage"];
export const STOCK_VIEW = ["stock.view", "stock.manage", "stock.adjust", "stock.receive"];
export const FACTORY_VIEW = ["factory.view", "factory.manage", "factory.report", "factory.approve"];
export const FINANCE_VIEW = ["payables.view", "receivables.view", "accounting.manage"];

/** Navigation item id → what its page needs (see `workspaceModules`). Items not listed are open to every member. */
export const NAVIGATION_ACCESS: Record<string, AccessRule> = {
  // Settings
  company: [ORGANIZATION_READ],
  "workspace-language": [ORGANIZATION_READ],
  "business-records": [ORGANIZATION_READ],
  "organizations-account": [ORGANIZATION_READ],
  "design-packages": [["crm.opportunities.view", "crm.settings.manage"]],
  "quotation-settings": [["pre_projects.view"]],
  "project-settings": [PROJECTS_VIEW],
  "purchasing-settings": [["purchasing.view", "workspace.settings.manage"]],
  "inventory-settings": [[...STOCK_VIEW, "purchasing.view", "workspace.settings.manage"]],
  "factory-settings": [[...FACTORY_VIEW, "workspace.settings.manage"]],
  "accounting-settings": [["accounting.manage"]],
  "attendance-settings": [["hrms.manage"]],
  members: [MEMBERS_READ],
  teams: [ORGANIZATION_READ, ["module.teams.read", "legal_entities.view"], MEMBERS_READ],
  roles: [[...MEMBERS_READ, "module.roles.read", "module.roles.write", "module.roles.edit", "module.roles.delete", "workspace.roles.manage"]],
  "audit-log": [["audit.view"]],
  integrations: [ORGANIZATION_READ, ["module.integrations.read", "integrations.view"]],
  "client-portal-settings": [["portal.manage", "pre_projects.view", "projects.view"]],
  "reminder-settings": [["crm.automations.view"]],
  "inbox-settings": [["crm.communications.view", "crm.settings.manage"]],
  "delivery-health": [["workspace.settings.manage", "integrations.manage"]],
  "ai-credits": [["workspace.settings.manage"]],
  // Everyone who can ask Woddy sees (and revokes) their own AI apps; administrators manage all of them.
  "ai-apps": [["ai.suggestions.use", "workspace.settings.manage"]],
  // Sales
  "crm-overview": [["crm.leads.view"]],
  leads: [["crm.leads.view"]],
  opportunities: [["crm.opportunities.view"]],
  customers: [["crm.parties.view"]],
  organizations: [["crm.parties.view"]],
  "follow-ups": [["crm.activities.view"]],
  calendar: [["crm.activities.view"]],
  activities: [["crm.activities.view"]],
  conversations: [["crm.communications.view"]],
  // Campaigns, Reports, Automations and the Sales settings sit inside Enquiries.
  "crm-campaigns": [["crm.leads.view"], ["crm.settings.manage"]],
  "crm-reports": [["crm.leads.view"], ["crm.reports.view"]],
  automations: [["crm.leads.view"], ["crm.automations.view"]],
  "crm-settings": [["crm.leads.view"], ["crm.settings.manage"]],
  // Planning
  "pre-projects": [["pre_projects.view"]],
  "pre-project-catalogs": [["catalog.view"]],
  "pre-project-supplier-offers": [["supplier_offers.view"]],
  "quotation-templates": [["pre_projects.view"]],
  // Projects and operations
  "projects-overview": [PROJECTS_VIEW],
  "global-purchasing": [PURCHASING_VIEW],
  "global-inventory": [STOCK_VIEW],
  "global-factory": [FACTORY_VIEW],
  "global-finance": [FINANCE_VIEW],
};

/** Sales › Enquiries sections (`?section=`) → the navigation entry that names them. */
export const SALES_SECTION_ACCESS: Record<string, string> = {
  forms: "crm-campaigns",
  sources: "crm-campaigns",
  reports: "crm-reports",
  assignment: "crm-settings",
  sla: "crm-settings",
  options: "crm-settings",
  automations: "automations",
};

/** Finance tabs → what each tab's data needs. */
export const FINANCE_TAB_ACCESS: Record<string, AccessRule> = {
  bills: [["payables.view"]],
  payments: [["payables.view"]],
  runs: [["payables.view"]],
  suppliers: [["payables.view"]],
  "petty-cash": [["payables.view"]],
  "client-invoices": [["receivables.view"]],
  accounting: [["accounting.manage"]],
};

/** Workspace areas reached by address (not only from navigation) → what opening them needs. */
const PATH_ACCESS: Array<[string, AccessRule]> = [
  ["/workspace/finance", [FINANCE_VIEW]],
  ["/workspace/purchasing", [PURCHASING_VIEW]],
  ["/workspace/inventory", [STOCK_VIEW]],
  ["/workspace/factory", [FACTORY_VIEW]],
];

export function isWorkspaceAdministrator(roles: readonly string[] | null | undefined) {
  return (roles ?? []).some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
}

/**
 * Whether the person finishes the workspace's first-time setup: the owner or an administrator. Everyone else
 * enters the workspace while it is being set up (no roles: an older session that doesn't say, which keeps the setup).
 */
export function canSetUpWorkspace(roles: readonly string[] | null | undefined) {
  return !Array.isArray(roles) || isWorkspaceAdministrator(roles);
}

export function meetsRule(rule: AccessRule | undefined, context: AccessContext): boolean {
  if (!rule?.length || isWorkspaceAdministrator(context.roles)) return true;
  const held = new Set(context.permissions ?? []);
  return rule.every((group) => group.some((code) => held.has(code)));
}

/** Whether the person can open the page behind a navigation item. */
export function canOpen(itemId: string, context: AccessContext): boolean {
  return meetsRule(NAVIGATION_ACCESS[itemId], context);
}

/** What an address needs before the page loads, or undefined when its page decides for itself. */
export function accessRuleForPath(pathname: string): AccessRule | undefined {
  return PATH_ACCESS.find(([root]) => pathname === root || pathname.startsWith(`${root}/`))?.[1];
}
