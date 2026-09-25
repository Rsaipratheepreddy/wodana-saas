export type WorkspaceIconName =
  | "activity"
  | "automations"
  | "boq"
  | "commercial"
  | "contracts"
  | "company"
  | "companies"
  | "conversations"
  | "customers"
  | "designs"
  | "documents"
  | "executionRelease"
  | "handover"
  | "home"
  | "installation"
  | "integrations"
  | "language"
  | "leads"
  | "materialPlan"
  | "measurements"
  | "members"
  | "opportunities"
  | "preProjects"
  | "procurement"
  | "production"
  | "projects"
  | "reports"
  | "requirements"
  | "roles"
  | "audit"
  | "billing"
  | "calendar"
  | "security"
  | "sequences"
  | "settings"
  | "siteVisits"
  | "snagging"
  | "teams"
  | "variations"
  | "followUps"
  | "workspace";

export type WorkspaceModuleId = "workspace" | "crm" | "pre-project" | "projects" | "hrms";

export type WorkspaceNavigationItem = {
  children?: WorkspaceNavigationSubItem[];
  description?: string;
  href: string;
  icon: WorkspaceIconName;
  id: string;
  label: string;
  showInSidebar?: boolean;
};

export type WorkspaceNavigationSubItem = {
  href: string;
  id: string;
  label: string;
};

export type WorkspaceNavigationSection = {
  id: string;
  items: WorkspaceNavigationItem[];
  label?: string;
};

export type WorkspaceModuleDefinition = {
  description: string;
  href: string;
  icon: WorkspaceIconName;
  id: WorkspaceModuleId;
  label: string;
  navigation: WorkspaceNavigationSection[];
};

export type WorkspaceIdentity = {
  description: string;
  id: string;
  imageUrl?: string;
  name: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
};

export type WorkspaceUser = {
  avatarUrl?: string;
  /** A chosen default avatar id, or "auto" for the stable default. */
  avatarPreset?: string;
  id?: string;
  email: string;
  name: string;
};

export const workspaceModules: WorkspaceModuleDefinition[] = [
  {
    description: "Company, team, connections and account",
    href: "/workspace/company",
    icon: "settings",
    id: "workspace",
    label: "Settings",
    navigation: [
      {
        id: "workspace-me",
        label: "Account",
        items: [
          { href: "/workspace/settings/profile", icon: "members", id: "profile", label: "Profile" },
          { href: "/workspace/settings/security", icon: "security", id: "security", label: "Sign-in security" },
        ],
      },
      {
        id: "workspace-company",
        label: "Company",
        items: [
          { href: "/workspace/company", icon: "company", id: "company", label: "Company profile" },
          { href: "/workspace/language", icon: "language", id: "workspace-language", label: "Workspace language" },
        ],
      },
      {
        id: "workspace-people",
        label: "Team & access",
        items: [
          { href: "/workspace/members", icon: "members", id: "members", label: "People" },
          // Groups are persisted, but do not yet drive project ownership, work
          // assignment, capacity, or delivery. Keep the route available while
          // withholding it from the primary workspace navigation until it does.
          { href: "/workspace/teams", icon: "teams", id: "teams", label: "Teams", showInSidebar: false },
          { href: "/workspace/roles", icon: "roles", id: "roles", label: "Roles & permissions" },
        ],
      },
      {
        id: "workspace-account",
        label: "Records & billing",
        items: [
          { href: "/workspace/legal-entities", icon: "company", id: "business-records", label: "Business records" },
          { href: "/workspace/billing", icon: "billing", id: "billing", label: "Billing" },
          { href: "/workspace/organizations", icon: "companies", id: "organizations-account", label: "Manage workspaces", showInSidebar: false },
          { href: "/workspace/settings/audit-logs", icon: "audit", id: "audit-log", label: "Audit history" },
        ],
      },
      {
        id: "workspace-connections",
        label: "Connections",
        items: [
          { href: "/workspace/integrations", icon: "integrations", id: "integrations", label: "Integrations" },
          { href: "/workspace/settings/client-portal", icon: "settings", id: "client-portal-settings", label: "Client portal" },
        ],
      },
    ],
  },
  {
    description: "Enquiries, customer decisions and follow-through",
    href: "/workspace/crm",
    icon: "leads",
    id: "crm",
    label: "Sales",
    navigation: [
      {
        id: "crm-flow",
        label: "Sales flow",
        items: [
          { href: "/workspace/crm", icon: "home", id: "crm-overview", label: "Overview" },
          { href: "/workspace/crm/jobs", icon: "projects", id: "jobs", label: "Jobs" },
          {
            href: "/workspace/crm/leads",
            icon: "leads",
            id: "leads",
            label: "Enquiries",
            description: "Capture, assign, respond to and review enquiries in one guided workspace.",
          },
          {
            href: "/workspace/crm/opportunities",
            icon: "opportunities",
            id: "opportunities",
            label: "Pipeline",
          },
          {
            href: "/workspace/crm/customers",
            icon: "customers",
            id: "customers",
            label: "Clients",
          },
        ],
      },
      {
        id: "crm-work",
        label: "Customer work",
        items: [
          {
            href: "/workspace/crm/follow-ups",
            icon: "followUps",
            id: "follow-ups",
            label: "Follow-ups",
          },
          {
            href: "/workspace/crm/follow-ups?view=schedule",
            icon: "calendar",
            id: "calendar",
            label: "Calendar",
          },
          {
            href: "/workspace/crm/conversations",
            icon: "conversations",
            id: "conversations",
            label: "Inbox",
          },
          {
            href: "/workspace/crm/automations",
            icon: "automations",
            id: "automations",
            label: "Automations",
          },
        ],
      },
      {
        id: "crm-records",
        label: "Customer records",
        items: [
          {
            href: "/workspace/crm/organizations",
            icon: "companies",
            id: "organizations",
            label: "Companies",
            showInSidebar: false,
          },
          {
            href: "/workspace/crm/activities",
            icon: "activity",
            id: "activities",
            label: "Activities",
            showInSidebar: false,
          },
        ],
      },
      {
        id: "crm-insights",
        label: "Insights",
        items: [
          {
            href: "/workspace/crm/reports",
            icon: "reports",
            id: "crm-reports",
            label: "Reports",
          },
        ],
      },
    ],
  },
  {
    description: "Requirements, quotations and client portal",
    href: "/workspace/pre-projects",
    icon: "preProjects",
    id: "pre-project",
    label: "Planning",
    navigation: [
      {
        id: "pre-project-primary",
        items: [
          {
            href: "/workspace/pre-projects",
            icon: "preProjects",
            id: "pre-projects",
            label: "Cases",
            description: "CRM-linked opportunities, assignments, stages, and next actions.",
          },
          {href:"/workspace/catalogs",icon:"materialPlan",id:"pre-project-catalogs",label:"Catalog",description:"Rooms, items, variants, materials and prices."},
          {href:"/workspace/pre-projects/supplier-offers",icon:"procurement",id:"pre-project-supplier-offers",label:"Supplier Offers",description:"Compare sourced costs, validity, lead time and evidence."},
          {href:"/workspace/pre-projects/quotation-templates",icon:"documents",id:"quotation-templates",label:"Quotation Templates",description:"Reusable quotation rooms, items, rates and terms."},
        ],
      },
      {
        id: "pre-project-requirements",
        label: "Requirement gathering",
        items: [
          {href:"/workspace/pre-projects/requirements",icon:"requirements",id:"requirements",label:"Requirements",description:"Client brief, notes, room scope, measurements and site layouts in one workspace."},
        ],
      },
      {
        id: "pre-project-case-sections",
        items: [
          {href:"/workspace/pre-projects/boq",icon:"commercial",id:"pre-project-design-quote",label:"Design Quote",description:"Prepare the first scope and costing pass for the shared quotation."},
          {href:"/workspace/pre-projects/designs",icon:"designs",id:"pre-project-designs",label:"Design & Specifications",description:"Design files, versions and client feedback."},
          {href:"/workspace/pre-projects/approvals",icon:"requirements",id:"pre-project-approvals",label:"Approvals",description:"Review the client's scope and design decisions."},
          {href:"/workspace/pre-projects/quotations",icon:"commercial",id:"pre-project-quotations",label:"Fitout / Furniture Quotations",description:"Prepare and issue the client-facing quotation."},
          {href:"/workspace/pre-projects/contracts",icon:"contracts",id:"pre-project-contracts",label:"Agreement",description:"Accepted scope, terms and signed agreement."},
          {href:"/workspace/pre-projects/overview",icon:"home",id:"pre-project-case-overview",label:"Case overview",description:"Owner, target, priority, risk and current stage."},
          {href:"/workspace/pre-projects/variations",icon:"variations",id:"pre-project-variations",label:"Change requests",description:"Client changes, commercial impact and resolution."},
        ],
      },
    ],
  },
  {
    description: "Delivery, procurement and handover",
    href: "/workspace/projects",
    icon: "projects",
    id: "projects",
    label: "Projects",
    navigation: [
      {
        id: "projects-plan",
        label: "Plan",
        items: [
          { href: "/workspace/projects", icon: "home", id: "projects-overview", label: "All projects", description: "Live delivery progress, milestones, blockers and decisions." },
          { href: "/workspace/projects/calendar", icon: "calendar", id: "projects-calendar", label: "Calendar", description: "Projects, resources, site visits and confirmed work in one schedule." },
          { href: "/workspace/projects/plan-teams", icon: "calendar", id: "plan-teams", label: "Plan & schedule", description: "Tasks, dates, milestones, teams and bookings." },
          { href: "/workspace/projects/boq", icon: "boq", id: "project-boq", label: "Scope", description: "Released scope items, approved sizes and delivery coverage." },
          { href: "/workspace/projects/documents", icon: "designs", id: "project-documents", label: "Drawings & documents", description: "Drawings, revisions and approved project documents." },
        ],
      },
      {
        id: "projects-build",
        label: "Build",
        items: [
          { href: "/workspace/projects/purchasing", icon: "procurement", id: "global-purchasing", label: "Purchasing", description: "Material shortages, supplier requests and orders across authorized projects." },
          { href: "/workspace/projects/inventory", icon: "materialPlan", id: "global-inventory", label: "Inventory", description: "Company warehouse stock, reservations and availability." },
          { href: "/workspace/projects/material-planning", icon: "materialPlan", id: "material-planning", label: "Materials", description: "Requirements, stock, allocations and warehouse transfers." },
          { href: "/workspace/projects/procurement", icon: "procurement", id: "procurement", label: "Purchasing", description: "Supplier enquiries, purchase orders, receipts and returns." },
          { href: "/workspace/projects/production", icon: "production", id: "production", label: "Factory", description: "Workshop jobs, approvals, output and dispatch." },
          { href: "/workspace/projects/site-work", icon: "installation", id: "site-work", label: "Site", description: "Site readiness, installation, commissioning and technical queries." },
          { href: "/workspace/projects/daily-progress", icon: "reports", id: "daily-progress", label: "Daily progress", description: "Field reports, evidence, workforce, blockers and review." },
        ],
      },
      {
        id: "projects-close",
        label: "Close",
        items: [
          { href: "/workspace/projects/snagging", icon: "snagging", id: "snagging", label: "Snags & warranty", description: "Defects, verification, closure and aftercare." },
          { href: "/workspace/projects/handover", icon: "handover", id: "handover", label: "Handover", description: "Client acceptance, completion records and warranties." },
          { href: "/workspace/projects/commercial", icon: "commercial", id: "project-commercial", label: "Budget & payments", description: "Contract value, budget, committed orders and payments." },
          { href: "/workspace/projects/workflow-templates", icon: "settings", id: "project-workflow-templates", label: "Workflow setup", description: "Reusable project stages, owners and release checks." },
        ],
      },
    ],
  },
  {
    description: "Attendance, sites and leave",
    href: "/workspace/hrms", icon: "members", id: "hrms", label: "People",
    navigation: [
      {id:"hrms-primary",label:"My work",items:[
        {href:"/workspace/hrms",icon:"activity",id:"hrms-overview",label:"My attendance"},
        {href:"/workspace/hrms/leave",icon:"calendar",id:"hrms-leave",label:"Leave"},
        {href:"/workspace/hrms/time-summary",icon:"reports",id:"hrms-summary",label:"Time summary"},
        {href:"/workspace/hrms/site-attendance",icon:"siteVisits",id:"hrms-sites",label:"Site attendance"},
      ]},
      {id:"hrms-team",label:"Team",items:[{href:"/workspace/hrms/team",icon:"teams",id:"hrms-team-attendance",label:"Team attendance"}]},
      {id:"hrms-admin",label:"Manage",items:[
        {href:"/workspace/hrms/people",icon:"members",id:"hrms-people",label:"People"},
        {href:"/workspace/hrms/workplaces",icon:"company",id:"hrms-workplaces",label:"Workplaces & assignments"},
        {href:"/workspace/hrms/settings",icon:"settings",id:"hrms-settings",label:"Calendar & policy"},
        {href:"/workspace/hrms/leave-settings",icon:"calendar",id:"hrms-leave-settings",label:"Leave allowances"},
      ]},
    ],
  },
];

export const workspaceNavigation = workspaceModules[0].navigation;

/** Build the product navigation from the server-authorized destinations. */
export function productNavigation(modules: WorkspaceModuleDefinition[]): WorkspaceNavigationSection[] {
  const allowed = new Set(modules.flatMap(module => module.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false).map(item => item.id)));
  const hasProjectTasks = allowed.has("projects-overview");
  const salesEntry = modules.find(module => module.id === "crm")?.navigation.flatMap(group => group.items).find(item => allowed.has(item.id) && ["crm-overview", "leads", "opportunities", "follow-ups"].includes(item.id));
  const sections: WorkspaceNavigationSection[] = [
    { id: "main", label: "Daily work", items: [
      { id: "home", label: "Home", href: "/workspace", icon: "home" },
      ...(allowed.has("conversations") ? [{ id: "inbox", label: "Inbox", href: "/workspace/crm/conversations", icon: "conversations" as const }] : []),
      ...(allowed.has("follow-ups") ? [{ id: "my-activity", label: "Tasks", href: hasProjectTasks ? "/workspace/tasks" : "/workspace/crm/follow-ups?view=activity", icon: "requirements" as const }, { id: "daily-follow-ups", label: "Calendar", href: "/workspace/crm/follow-ups?view=schedule", icon: "calendar" as const }] : allowed.has("calendar") ? [{ id: "daily-follow-ups", label: "Calendar", href: "/workspace/crm/follow-ups?view=schedule", icon: "calendar" as const }] : []),
      ...(hasProjectTasks && !allowed.has("follow-ups") ? [{id:"my-activity",label:"Tasks",href:"/workspace/tasks",icon:"requirements" as const}] : []),
      ...((allowed.has("projects-overview") || allowed.has("pre-projects")) ? [{ id: "approvals", label: "Approvals", href: "/workspace/approvals", icon: "preProjects" as const }] : []),
    ] },
    { id: "work", label: "Business", items: [
      ...(salesEntry ? [{ id: "sales", label: "Sales", href: salesEntry.href, icon: "opportunities" as const }] : []),
      ...(allowed.has("customers") || allowed.has("projects-overview") ? [{ id: "clients", label: "Clients", href: allowed.has("customers") ? "/workspace/crm/customers" : "/workspace/projects/clients", icon: "customers" as const }] : []),
      ...((allowed.has("projects-overview") || allowed.has("pre-projects")) ? [{ id: "projects", label: "Projects", href: "/workspace/projects", icon: "projects" as const }] : []),
    ] },
    { id: "operations", label: "Operations", items: [
      ...(allowed.has("global-purchasing") ? [{ id: "purchasing", label: "Purchasing", href: "/workspace/projects/purchasing", icon: "procurement" as const }] : []),
      ...(allowed.has("global-inventory") ? [{ id: "inventory", label: "Inventory", href: "/workspace/projects/inventory", icon: "materialPlan" as const }] : []),
      ...(allowed.has("production") ? [{ id: "factory", label: "Factory", href: "/workspace/projects/factory", icon: "production" as const }] : []),
    ] },
    { id: "utilities", label: "Company", items: [
      ...(allowed.has("hrms-overview") ? [{ id: "team", label: "People", description: "Team, attendance and leave", href: "/workspace/hrms", icon: "members" as const }] : []),
      ...(allowed.has("pre-project-catalogs") ? [{ id: "resources", label: "Catalog", description: "Shared items, materials and prices", href: "/workspace/catalogs", icon: "materialPlan" as const }] : []),
      ...(allowed.has("integrations") ? [{ id: "integrations", label: "Connections", href: "/workspace/integrations", icon: "integrations" as const }] : []),
      ...(modules.find(module => module.id === "workspace")?.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false && item.id !== "integrations").sort((a, b) => Number(b.id === "company") - Number(a.id === "company")).slice(0, 1).map(item => ({ id: "settings", label: "Settings", href: item.href, icon: "settings" as const })) ?? []),
    ] },
  ];
  return sections.filter(section => section.items.length);
}

export function productNavigationActive(pathname: string, query: URLSearchParams, sections: WorkspaceNavigationSection[]): string | undefined {
  const items = sections.flatMap(section => section.items);
  const exists = (id: string) => items.some(item => item.id === id) ? id : undefined;
  const under = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  if (pathname === "/workspace") return exists("home");
  if (under("/workspace/catalogs") || under("/workspace/pre-projects/catalogs") || under("/workspace/pre-projects/master-data")) return exists("resources");
  if (under("/workspace/crm/conversations")) return exists("inbox");
  if (under("/workspace/crm/customers") || under("/workspace/crm/organizations")) return exists("clients");
  if (under("/workspace/crm/calendar")) return exists("daily-follow-ups");
  if (under("/workspace/crm/follow-ups") && query.get("view") === "schedule") return exists("daily-follow-ups");
  if (under("/workspace/tasks")) return exists("my-activity");
  if (under("/workspace/approvals")) return exists("approvals");
  if (under("/workspace/crm/follow-ups") && query.get("view") === "activity") return exists("my-activity");
  if (under("/workspace/crm")) return exists("sales");
  if (under("/workspace/pre-projects")) return exists("projects");
  if (under("/workspace/projects/clients")) return exists("clients");
  if (under("/workspace/projects/purchasing")) return exists("purchasing");
  if (under("/workspace/projects/inventory")) return exists("inventory");
  if (under("/workspace/projects/factory")) return exists("factory");
  if (under("/workspace/projects")) return exists("projects");
  if (under("/workspace/hrms")) return exists("team");
  if (under("/workspace/integrations")) return exists("integrations");
  return exists("settings");
}

export const workspaceScreens = workspaceModules.flatMap((module) =>
  module.navigation.flatMap((section) => section.items),
);

export function findWorkspaceModule(
  pathname: string,
  modules: WorkspaceModuleDefinition[] = workspaceModules,
) {
  return (
    modules
      .slice(1)
      .find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`)) ??
    modules[0]
  );
}

export function findWorkspaceScreen(
  pathname: string,
  modules: WorkspaceModuleDefinition[] = workspaceModules,
) {
  const activeModule = findWorkspaceModule(pathname, modules);
  const screens = modules.flatMap((module) =>
    module.navigation.flatMap((section) => section.items),
  );
  const prefixMatch = screens
    .filter((item) => pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
  return (
    screens.find((item) => item.href === pathname) ??
    prefixMatch ??
    activeModule.navigation[0]?.items[0] ??
    screens[0]
  );
}
