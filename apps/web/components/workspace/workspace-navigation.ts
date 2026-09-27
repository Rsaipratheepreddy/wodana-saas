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
  /** Other paths the module owns besides its own (e.g. Projects owns Purchasing). */
  paths?: string[];
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
          { href: "/workspace/settings/design-packages", icon: "designs", id: "design-packages", label: "Design packages" },
          { href: "/workspace/settings/quotations", icon: "commercial", id: "quotation-settings", label: "Quotations" },
          { href: "/workspace/settings/projects", icon: "projects", id: "project-settings", label: "Projects" },
          { href: "/workspace/settings/purchasing", icon: "procurement", id: "purchasing-settings", label: "Purchasing" },
          { href: "/workspace/settings/inventory", icon: "materialPlan", id: "inventory-settings", label: "Stock places" },
          { href: "/workspace/settings/factory", icon: "production", id: "factory-settings", label: "Factory" },
          { href: "/workspace/gallery", icon: "designs", id: "gallery", label: "Gallery", showInSidebar: false },
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
          { href: "/workspace/settings/reminders", icon: "settings", id: "reminder-settings", label: "Reminders" },
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
    description: "Delivery from the accepted quotation to handover",
    href: "/workspace/projects",
    icon: "projects",
    id: "projects",
    label: "Projects",
    paths: ["/workspace/purchasing", "/workspace/inventory", "/workspace/factory", "/workspace/finance"],
    navigation: [
      {
        id: "projects-primary",
        items: [
          { href: "/workspace/projects", icon: "home", id: "projects-overview", label: "Projects", description: "Every project: stage, next step and handover date." },
          { href: "/workspace/purchasing", icon: "procurement", id: "global-purchasing", label: "Purchasing", description: "What to order, orders and suppliers." },
          { href: "/workspace/inventory", icon: "materialPlan", id: "global-inventory", label: "Inventory", description: "Stock by place, moves and counts." },
          { href: "/workspace/factory", icon: "production", id: "global-factory", label: "Factory", description: "What to make, work orders and their checks." },
          { href: "/workspace/finance", icon: "commercial", id: "global-finance", label: "Finance", description: "Supplier invoices, payments and what's owed." },
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
    // Daily work: Home (Overview, Tasks, Approvals as tabs), then Calendar and Inbox on their own.
    { id: "main", label: "Daily work", items: [
      { id: "home", label: "Home", href: "/workspace", icon: "home" },
      ...(allowed.has("follow-ups") || allowed.has("calendar") ? [{ id: "daily-follow-ups", label: "Calendar", href: "/workspace/crm/follow-ups?view=schedule", icon: "calendar" as const }] : []),
      ...(allowed.has("conversations") ? [{ id: "inbox", label: "Inbox", href: "/workspace/crm/conversations", icon: "conversations" as const }] : []),
    ] },
    { id: "work", label: "Business", items: [
      ...(salesEntry ? [{ id: "sales", label: "Sales", href: salesEntry.href, icon: "opportunities" as const }] : []),
      ...(allowed.has("customers") || allowed.has("projects-overview") ? [{ id: "clients", label: "Clients", href: allowed.has("customers") ? "/workspace/crm/customers" : "/workspace/projects/clients", icon: "customers" as const }] : []),
      ...(allowed.has("pre-projects") ? [{ id: "planning", label: "Planning", href: "/workspace/pre-projects", icon: "preProjects" as const }] : []),
      ...(allowed.has("projects-overview") ? [{ id: "projects", label: "Projects", href: "/workspace/projects", icon: "projects" as const }] : []),
      ...(allowed.has("global-finance") ? [{ id: "finance", label: "Finance", href: "/workspace/finance", icon: "commercial" as const }] : []),
    ] },
    { id: "operations", label: "Operations", items: [
      ...(allowed.has("global-purchasing") ? [{ id: "purchasing", label: "Purchasing", href: "/workspace/purchasing", icon: "procurement" as const }] : []),
      ...(allowed.has("global-inventory") ? [{ id: "inventory", label: "Inventory", href: "/workspace/inventory", icon: "materialPlan" as const }] : []),
      ...(allowed.has("global-factory") ? [{ id: "factory", label: "Factory", href: "/workspace/factory", icon: "production" as const }] : []),
    ] },
    { id: "utilities", label: "Company", items: [
      ...(allowed.has("hrms-overview") ? [{ id: "team", label: "People", description: "Team, attendance and leave", href: "/workspace/hrms", icon: "members" as const }] : []),
      ...(allowed.has("pre-project-catalogs") ? [{ id: "resources", label: "Catalog", description: "Shared items, materials and prices", href: "/workspace/catalogs", icon: "materialPlan" as const }] : []),
      ...(modules.some(module => module.navigation.some(group => group.items.some(item => item.id === "gallery"))) ? [{ id: "gallery", label: "Gallery", description: "Your brochure to share", href: "/workspace/gallery", icon: "designs" as const }] : []),
      ...(allowed.has("integrations") ? [{ id: "integrations", label: "Connections", href: "/workspace/integrations", icon: "integrations" as const }] : []),
      ...(modules.find(module => module.id === "workspace")?.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false && item.id !== "integrations").sort((a, b) => Number(b.id === "company") - Number(a.id === "company")).slice(0, 1).map(item => ({ id: "settings", label: "Settings", href: item.href, icon: "settings" as const })) ?? []),
    ] },
  ];
  return sections.filter(section => section.items.length);
}

/** The tabs on Home: the overview plus the person's own queues. */
export function homeTabs(modules: WorkspaceModuleDefinition[]): { id: string; label: string; href: string }[] {
  const allowed = new Set(modules.flatMap(module => module.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false).map(item => item.id)));
  const projectTasks = allowed.has("projects-overview");
  return [
    { id: "overview", label: "Overview", href: "/workspace" },
    ...(projectTasks || allowed.has("follow-ups") ? [{ id: "tasks", label: "Tasks", href: projectTasks ? "/workspace/tasks" : "/workspace/crm/follow-ups?view=activity" }] : []),
    ...(allowed.has("projects-overview") || allowed.has("pre-projects") ? [{ id: "approvals", label: "Approvals", href: "/workspace/approvals" }] : []),
  ];
}
export const HOME_ROUTES = ["/workspace", "/workspace/tasks", "/workspace/approvals"];

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
  if (under("/workspace/tasks") || under("/workspace/approvals")) return exists("home");
  if (under("/workspace/crm/follow-ups") && query.get("view") === "activity") return exists("home");
  if (under("/workspace/crm")) return exists("sales");
  if (under("/workspace/pre-projects")) return exists("planning") ?? exists("projects");
  if (under("/workspace/projects/clients")) return exists("clients");
  if (under("/workspace/purchasing")) return exists("purchasing");
  if (under("/workspace/inventory")) return exists("inventory");
  if (under("/workspace/factory")) return exists("factory");
  if (under("/workspace/finance")) return exists("finance");
  if (under("/workspace/projects")) return exists("projects");
  if (under("/workspace/hrms")) return exists("team");
  if (under("/workspace/integrations")) return exists("integrations");
  if (under("/workspace/gallery")) return exists("gallery");
  return exists("settings");
}

export const workspaceScreens = workspaceModules.flatMap((module) =>
  module.navigation.flatMap((section) => section.items),
);

export function findWorkspaceModule(
  pathname: string,
  modules: WorkspaceModuleDefinition[] = workspaceModules,
) {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return modules.slice(1).find((module) => under(module.href) || module.paths?.some(under)) ?? modules[0];
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
