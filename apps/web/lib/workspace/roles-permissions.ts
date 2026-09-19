import type { WorkspaceRole } from "./members";

export type WorkspacePermissionDefinition = {
  code: string;
  description: string;
};

export type PermissionAreaId = "all" | "workspace" | "crm" | "pre-execution" | "projects" | "hrms" | "platform";

export const PERMISSION_AREAS: Array<{ id: PermissionAreaId; label: string }> = [
  { id: "all", label: "All" },
  { id: "workspace", label: "Workspace" },
  { id: "crm", label: "CRM" },
  { id: "pre-execution", label: "Pre-execution" },
  { id: "projects", label: "Projects" },
  { id: "hrms", label: "HRMS" },
  { id: "platform", label: "AI & platform" },
];

const RESOURCE_LABELS: Record<string, string> = {
  "module.organization": "organization profile",
  "module.members": "people",
  "module.teams": "work groups",
  "module.roles": "roles and permissions",
  "module.integrations": "integrations",
  "workspace.members": "people",
  "workspace.roles": "roles and permissions",
  "workspace.settings": "workspace settings",
  legal_entities: "business records",
  integrations: "integrations",
  "crm.parties": "customers",
  "crm.leads": "enquiries",
  "crm.opportunities": "opportunities",
  "crm.activities": "activities and follow-ups",
  "crm.automations": "smart rules",
  "crm.communications": "customer communications",
  "crm.consent": "customer consent",
  "crm.notifications": "CRM notifications",
  "crm.privacy": "CRM privacy",
  "crm.reports": "CRM reports",
  "crm.settings": "CRM settings",
  jobs: "Jobs",
  "jobs.stage": "Job stages",
  pre_projects: "pre-execution cases",
  commercial: "quotations and agreements",
  "commercial.costs": "internal quotation costs",
  "commercial.finance": "payment evidence",
  catalog: "master data",
  supplier_offers: "supplier offers",
  vendors: "vendors",
  portal: "client portal",
  projects: "projects",
  "projects.schedule": "project schedules",
  hrms: "HRMS",
  audit: "audit history",
  "finance.settings": "finance settings",
  "ai.suggestions": "AI suggestions",
};

const ACTION_LABELS: Record<string, string> = {
  read: "View",
  view: "View",
  write: "Create",
  create: "Create",
  edit: "Edit",
  manage: "Manage",
  delete: "Delete",
  assign: "Assign",
  export: "Export",
  merge: "Merge",
  publish: "Publish",
  send: "Send",
  transition: "Move",
  approve: "Approve",
  release: "Release",
  verify: "Verify",
  buy: "Manage procurement for",
  report: "Report progress for",
  review: "Review",
  repair: "Repair",
  use: "Use",
};

const EXACT_LABELS: Record<string, string> = {
  "ai.suggestions.use": "Use AI suggestions",
  "commercial.override_price": "Override quotation prices",
  "crm.opportunities.sensitive_values": "View sensitive opportunity values",
  "crm.privacy.erase": "Erase customer data",
  "hrms.evidence": "Record attendance evidence",
  "hrms.manage": "Manage HRMS",
  "hrms.self": "Use own attendance and leave",
  "hrms.team": "Review team attendance and leave",
  "jobs.stage.manage": "Manage Job stages",
  "pre_projects.manage_lifecycle": "Manage pre-execution lifecycle",
  "pre_projects.publish_definition": "Publish scope confirmation",
  "pre_projects.record_client_definition_decisions": "Record client scope decisions",
  "pre_projects.record_client_design_decisions": "Record client design decisions",
  "pre_projects.review_designs": "Review design revisions",
  "pre_projects.verify_measurements": "Verify site measurements",
  "projects.schedule.override": "Override project schedule conflicts",
};

function words(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function permissionArea(code: string): Exclude<PermissionAreaId, "all"> {
  if (code.startsWith("crm.") || code.startsWith("jobs.")) return "crm";
  if (["pre_projects.", "commercial.", "catalog.", "supplier_offers.", "vendors.", "portal."].some((prefix) => code.startsWith(prefix))) return "pre-execution";
  if (code.startsWith("projects.")) return "projects";
  if (code.startsWith("hrms.")) return "hrms";
  if (code.startsWith("ai.")) return "platform";
  return "workspace";
}

export function permissionAreaLabel(code: string) {
  const area = permissionArea(code);
  return PERMISSION_AREAS.find((item) => item.id === area)?.label ?? "Workspace";
}

export function permissionLabel(code: string) {
  if (EXACT_LABELS[code]) return EXACT_LABELS[code];
  const resourceCode = Object.keys(RESOURCE_LABELS)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => code.startsWith(`${candidate}.`));
  if (!resourceCode) return words(code);
  const action = code.slice(resourceCode.length + 1);
  const verb = ACTION_LABELS[action] ?? words(action);
  return `${verb} ${RESOURCE_LABELS[resourceCode]}`;
}

export type RolesPermissionsPageData = {
  canManage: boolean;
  memberCount: number;
  permissions: WorkspacePermissionDefinition[];
  roles: WorkspaceRole[];
  workspaceId: string;
};

// Every code below is registered by a business-core migration. This fixture
// keeps the local workspace faithful to the production permission catalogue.
const FIXTURE_PERMISSION_CODES = [
  "module.organization.read", "module.organization.write", "module.organization.edit", "module.organization.delete",
  "module.members.read", "module.members.write", "module.members.edit", "module.members.delete",
  "module.teams.read", "module.teams.write", "module.teams.edit", "module.teams.delete",
  "module.roles.read", "module.roles.write", "module.roles.edit", "module.roles.delete",
  "module.integrations.read", "module.integrations.write", "module.integrations.edit", "module.integrations.delete",
  "workspace.members.manage", "workspace.roles.manage", "workspace.settings.manage",
  "legal_entities.view", "legal_entities.manage", "integrations.view", "integrations.manage", "audit.view", "finance.settings.manage",
  "crm.parties.view", "crm.parties.manage", "crm.parties.export", "crm.parties.merge",
  "crm.leads.view", "crm.leads.manage", "crm.leads.assign",
  "crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.transition", "crm.opportunities.sensitive_values",
  "crm.activities.view", "crm.activities.manage", "crm.automations.view", "crm.automations.manage", "crm.automations.publish",
  "crm.communications.view", "crm.communications.send", "crm.consent.manage", "crm.notifications.view", "crm.notifications.manage",
  "crm.privacy.erase", "crm.reports.view", "crm.settings.manage", "jobs.repair", "jobs.stage.manage",
  "pre_projects.view", "pre_projects.create", "pre_projects.edit", "pre_projects.manage_lifecycle",
  "pre_projects.review_designs", "pre_projects.record_client_design_decisions", "pre_projects.verify_measurements",
  "pre_projects.publish_definition", "pre_projects.record_client_definition_decisions",
  "commercial.approve", "commercial.release", "commercial.override_price", "commercial.finance.verify",
  "commercial.costs.view", "commercial.costs.manage", "catalog.view", "catalog.manage",
  "supplier_offers.view", "supplier_offers.manage", "vendors.view", "vendors.manage", "portal.manage",
  "projects.view", "projects.manage", "projects.report", "projects.review", "projects.buy",
  "projects.schedule.view", "projects.schedule.manage", "projects.schedule.override",
  "hrms.self", "hrms.team", "hrms.manage", "hrms.evidence", "ai.suggestions.use",
] as const;

export const workspacePermissionFixture: WorkspacePermissionDefinition[] = FIXTURE_PERMISSION_CODES.map((code) => ({
  code,
  description: permissionLabel(code),
}));

const allFixturePermissions = workspacePermissionFixture.map((permission) => permission.code);
const readOnlyFixturePermissions = workspacePermissionFixture
  .filter((permission) => /\.(read|view)$/.test(permission.code) || permission.code === "hrms.self")
  .map((permission) => permission.code);

export const rolesPermissionsFixture: RolesPermissionsPageData = {
  canManage: true,
  memberCount: 1,
  permissions: workspacePermissionFixture,
  roles: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      code: "owner",
      name: "Owner",
      description: "Full workspace control, including ownership and billing.",
      isSystem: true,
      version: 1,
      memberCount: 1,
      permissions: allFixturePermissions,
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      code: "administrator",
      name: "Administrator",
      description: "Manages workspace configuration, people, and access.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: allFixturePermissions,
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      code: "member",
      name: "Member",
      description: "Standard access to assigned workspace areas.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: ["hrms.self", "projects.view", "projects.report", "crm.activities.view"],
    },
    {
      id: "00000000-0000-4000-8000-000000000007",
      code: "viewer",
      name: "Viewer",
      description: "Read-only access to permitted workspace information.",
      isSystem: true,
      version: 1,
      memberCount: 0,
      permissions: readOnlyFixturePermissions,
    },
    {
      id: "00000000-0000-4000-8000-000000000008",
      code: "studio_lead",
      name: "Studio lead",
      description: "Coordinates design, pricing, delivery and the studio team.",
      isSystem: false,
      version: 1,
      memberCount: 0,
      permissions: [
        "module.organization.read", "module.organization.edit", "module.members.read", "module.teams.read", "module.teams.edit",
        "crm.parties.view", "crm.leads.view", "crm.leads.manage", "crm.opportunities.view", "crm.activities.view",
        "pre_projects.view", "pre_projects.create", "pre_projects.edit", "pre_projects.review_designs", "pre_projects.verify_measurements",
        "catalog.view", "catalog.manage", "commercial.costs.view", "commercial.approve",
        "projects.view", "projects.manage", "projects.report", "projects.review", "hrms.self", "hrms.team", "ai.suggestions.use",
      ],
    },
  ],
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
