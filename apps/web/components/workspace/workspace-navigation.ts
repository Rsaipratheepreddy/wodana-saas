import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";
import { tKey } from "@/lib/i18n/keys";

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
  /** Workspace role codes: the main one chooses the default role avatar. */
  roles?: string[];
  email: string;
  name: string;
};

export const workspaceModules: WorkspaceModuleDefinition[] = [
  {
    description: tKey("Company, team, connections and account"),
    href: "/workspace/company",
    icon: "settings",
    id: "workspace",
    label: tKey("Settings"),
    navigation: [
      {
        id: "workspace-me",
        label: tKey("Account"),
        items: [
          { href: "/workspace/settings/profile", icon: "members", id: "profile", label: tKey("Profile") },
          { href: "/workspace/settings/security", icon: "security", id: "security", label: tKey("Sign-in security") },
          { href: "/workspace/settings/notifications", icon: "settings", id: "notification-settings", label: tKey("Notifications") },
        ],
      },
      {
        id: "workspace-company",
        label: tKey("Company"),
        items: [
          { href: "/workspace/company", icon: "company", id: "company", label: tKey("Company profile") },
          { href: "/workspace/language", icon: "language", id: "workspace-language", label: tKey("Workspace language") },
          { href: "/workspace/legal-entities", icon: "company", id: "business-records", label: tKey("Business records") },
          { href: "/workspace/billing", icon: "billing", id: "billing", label: tKey("Billing") },
          { href: "/workspace/settings/ai-credits", icon: "billing", id: "ai-credits", label: tKey("AI credits") },
          { href: "/workspace/settings/audit-logs", icon: "audit", id: "audit-log", label: tKey("Audit history") },
          { href: "/workspace/organizations", icon: "companies", id: "organizations-account", label: tKey("Manage workspaces"), showInSidebar: false },
          { href: "/workspace/gallery", icon: "designs", id: "gallery", label: tKey("Gallery"), showInSidebar: false },
        ],
      },
      {
        // How each module works for this firm.
        id: "workspace-modules",
        label: tKey("Modules"),
        items: [
          { href: "/workspace/settings/quotations", icon: "commercial", id: "quotation-settings", label: tKey("Quotations") },
          { href: "/workspace/settings/design-packages", icon: "designs", id: "design-packages", label: tKey("Design packages") },
          { href: "/workspace/settings/projects", icon: "projects", id: "project-settings", label: tKey("Projects") },
          { href: "/workspace/settings/purchasing", icon: "procurement", id: "purchasing-settings", label: tKey("Purchasing") },
          { href: "/workspace/settings/inventory", icon: "materialPlan", id: "inventory-settings", label: tKey("Stock places") },
          { href: "/workspace/settings/factory", icon: "production", id: "factory-settings", label: tKey("Factory") },
          { href: "/workspace/settings/accounting", icon: "integrations", id: "accounting-settings", label: tKey("Accounting") },
          { href: "/workspace/settings/attendance", icon: "calendar", id: "attendance-settings", label: tKey("Attendance & leave") },
          { href: "/workspace/settings/inbox", icon: "conversations", id: "inbox-settings", label: tKey("Inbox") },
          { href: "/workspace/settings/reminders", icon: "settings", id: "reminder-settings", label: tKey("Reminders") },
          { href: "/workspace/settings/client-portal", icon: "settings", id: "client-portal-settings", label: tKey("Client portal") },
        ],
      },
      {
        // These pages live in People (sidebar → People); Settings links to them rather than copying them.
        id: "workspace-people",
        label: tKey("People & access"),
        items: [
          { href: "/workspace/members", icon: "members", id: "members", label: tKey("People") },
          { href: "/workspace/teams", icon: "teams", id: "teams", label: tKey("Teams") },
          { href: "/workspace/roles", icon: "roles", id: "roles", label: tKey("Roles & permissions") },
        ],
      },
      {
        id: "workspace-connections",
        label: tKey("Connections"),
        items: [
          { href: "/workspace/integrations", icon: "integrations", id: "integrations", label: tKey("Integrations") },
          { href: "/workspace/settings/delivery", icon: "settings", id: "delivery-health", label: tKey("Delivery") },
          { href: "/workspace/settings/ai-apps", icon: "integrations", id: "ai-apps", label: tKey("AI apps") },
        ],
      },
    ],
  },
  {
    description: tKey("Enquiries, customer decisions and follow-through"),
    href: "/workspace/crm",
    icon: "leads",
    id: "crm",
    label: tKey("Sales"),
    navigation: [
      {
        id: "crm-flow",
        label: tKey("Sales flow"),
        items: [
          { href: "/workspace/crm", icon: "home", id: "crm-overview", label: tKey("Overview") },
          {
            href: "/workspace/crm/leads",
            icon: "leads",
            id: "leads",
            label: tKey("Enquiries"),
            description: tKey("Capture, assign, respond to and review enquiries in one guided workspace."),
          },
          {
            href: "/workspace/crm/opportunities",
            icon: "opportunities",
            id: "opportunities",
            label: tKey("Pipeline"),
          },
          {
            href: "/workspace/crm/customers",
            icon: "customers",
            id: "customers",
            label: tKey("Clients"),
          },
        ],
      },
      {
        id: "crm-work",
        label: tKey("Customer work"),
        items: [
          {
            href: "/workspace/crm/follow-ups",
            icon: "followUps",
            id: "follow-ups",
            label: tKey("Follow-ups"),
          },
          {
            href: "/workspace/crm/follow-ups?view=schedule",
            icon: "calendar",
            id: "calendar",
            label: tKey("Calendar"),
          },
          {
            href: "/workspace/crm/conversations",
            icon: "conversations",
            id: "conversations",
            label: tKey("Inbox"),
          },
          {
            href: "/workspace/crm/automations",
            icon: "automations",
            id: "automations",
            label: tKey("Automations"),
          },
        ],
      },
      {
        id: "crm-records",
        label: tKey("Customer records"),
        items: [
          {
            href: "/workspace/crm/organizations",
            icon: "companies",
            id: "organizations",
            label: tKey("Companies"),
            showInSidebar: false,
          },
          {
            href: "/workspace/crm/activities",
            icon: "activity",
            id: "activities",
            label: tKey("Activities"),
            showInSidebar: false,
          },
        ],
      },
      {
        id: "crm-insights",
        label: tKey("Insights"),
        items: [
          {
            href: "/workspace/crm/reports",
            icon: "reports",
            id: "crm-reports",
            label: tKey("Reports"),
          },
        ],
      },
      {
        // Sections of Enquiries, named so navigation offers them only to people who can use them.
        id: "crm-setup",
        label: "Setup",
        items: [
          { href: "/workspace/crm/leads?section=forms", icon: "documents", id: "crm-campaigns", label: "Campaigns", showInSidebar: false },
          { href: "/workspace/crm/leads?section=assignment", icon: "settings", id: "crm-settings", label: "Settings", showInSidebar: false },
        ],
      },
    ],
  },
  {
    description: tKey("Requirements, quotations and client portal"),
    href: "/workspace/pre-projects",
    icon: "preProjects",
    id: "pre-project",
    label: tKey("Planning"),
    navigation: [
      {
        id: "pre-project-primary",
        items: [
          {
            href: "/workspace/pre-projects",
            icon: "preProjects",
            id: "pre-projects",
            label: tKey("Cases"),
            description: tKey("CRM-linked opportunities, assignments, stages, and next actions."),
          },
          {href:"/workspace/catalogs",icon:"materialPlan",id:"pre-project-catalogs",label:tKey("Catalog"),description:tKey("Rooms, items, variants, materials and prices.")},
          {href:"/workspace/pre-projects/supplier-offers",icon:"procurement",id:"pre-project-supplier-offers",label:tKey("Supplier Offers"),description:tKey("Compare sourced costs, validity, lead time and evidence.")},
          {href:"/workspace/pre-projects/quotation-templates",icon:"documents",id:"quotation-templates",label:tKey("Quotation Templates"),description:tKey("Reusable quotation rooms, items, rates and terms.")},
        ],
      },
      {
        id: "pre-project-requirements",
        label: tKey("Requirement gathering"),
        items: [
          {href:"/workspace/pre-projects/requirements",icon:"requirements",id:"requirements",label:tKey("Requirements"),description:tKey("Client brief, notes, room scope, measurements and site layouts in one workspace.")},
        ],
      },
      {
        id: "pre-project-case-sections",
        items: [
          {href:"/workspace/pre-projects/boq",icon:"commercial",id:"pre-project-design-quote",label:tKey("Design Quote"),description:tKey("Prepare the first scope and costing pass for the shared quotation.")},
          {href:"/workspace/pre-projects/designs",icon:"designs",id:"pre-project-designs",label:tKey("Design & Specifications"),description:tKey("Design files, versions and client feedback.")},
          {href:"/workspace/pre-projects/approvals",icon:"requirements",id:"pre-project-approvals",label:tKey("Approvals"),description:tKey("Review the client's scope and design decisions.")},
          {href:"/workspace/pre-projects/quotations",icon:"commercial",id:"pre-project-quotations",label:tKey("Fitout / Furniture Quotations"),description:tKey("Prepare and issue the client-facing quotation.")},
          {href:"/workspace/pre-projects/contracts",icon:"contracts",id:"pre-project-contracts",label:tKey("Agreement"),description:tKey("Accepted scope, terms and signed agreement.")},
          {href:"/workspace/pre-projects/overview",icon:"home",id:"pre-project-case-overview",label:tKey("Case overview"),description:tKey("Owner, target, priority, risk and current stage.")},
          {href:"/workspace/pre-projects/variations",icon:"variations",id:"pre-project-variations",label:tKey("Change requests"),description:tKey("Client changes, commercial impact and resolution.")},
        ],
      },
    ],
  },
  {
    description: tKey("Delivery from the accepted quotation to handover"),
    href: "/workspace/projects",
    icon: "projects",
    id: "projects",
    label: tKey("Projects"),
    paths: ["/workspace/purchasing", "/workspace/inventory", "/workspace/factory", "/workspace/finance"],
    navigation: [
      {
        id: "projects-primary",
        items: [
          { href: "/workspace/projects", icon: "home", id: "projects-overview", label: tKey("Projects"), description: tKey("Every project: stage, next step and handover date.") },
          { href: "/workspace/purchasing", icon: "procurement", id: "global-purchasing", label: tKey("Purchasing"), description: tKey("What to order, orders and suppliers.") },
          { href: "/workspace/inventory", icon: "materialPlan", id: "global-inventory", label: tKey("Inventory"), description: tKey("Stock by place, moves and counts.") },
          { href: "/workspace/factory", icon: "production", id: "global-factory", label: tKey("Factory"), description: tKey("What to make, work orders and their checks.") },
          { href: "/workspace/finance", icon: "commercial", id: "global-finance", label: tKey("Finance"), description: tKey("Supplier invoices, payments and what's owed.") },
        ],
      },
    ],
  },
  {
    description: tKey("Attendance, leave and the team"),
    href: "/workspace/hrms", icon: "members", id: "hrms", label: tKey("People"),
    navigation: [
      {
        id: "hrms-primary",
        items: [
          { href: "/workspace/hrms", icon: "activity", id: "hrms-overview", label: tKey("Attendance") },
          { href: "/workspace/hrms/leave", icon: "calendar", id: "hrms-leave", label: tKey("Leave") },
          { href: "/workspace/hrms/team", icon: "teams", id: "hrms-team", label: tKey("Team") },
          { href: "/workspace/hrms/people", icon: "members", id: "hrms-people", label: tKey("HR records") },
          // Tabs of People reached from the page itself and from notices; named here for the breadcrumb.
          { href: "/workspace/hrms/time", icon: "calendar", id: "hrms-time", label: tKey("Time"), showInSidebar: false },
          { href: "/workspace/hrms/documents", icon: "members", id: "hrms-documents", label: tKey("Documents"), showInSidebar: false },
          { href: "/workspace/hrms/crews", icon: "teams", id: "hrms-crews", label: tKey("Crews"), showInSidebar: false },
          { href: "/workspace/hrms/payroll", icon: "members", id: "hrms-payroll", label: tKey("Payroll"), showInSidebar: false },
        ],
      },
    ],
  },
];

export const workspaceNavigation = workspaceModules[0].navigation;

/** Build the product navigation from the server-authorized destinations. */
export function productNavigation(modules: WorkspaceModuleDefinition[]): WorkspaceNavigationSection[] {
  const allowed = new Set(modules.flatMap(module => module.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false).map(item => item.id)));
  const salesEntry = modules.find(module => module.id === "crm")?.navigation.flatMap(group => group.items).find(item => allowed.has(item.id) && ["crm-overview", "leads", "opportunities", "follow-ups"].includes(item.id));
  const sections: WorkspaceNavigationSection[] = [
    // Daily work: Home (Overview, Tasks, Approvals as tabs), then Calendar and Inbox on their own.
    { id: "main", label: tKey("Daily work"), items: [
      { id: "home", label: tKey("Home"), href: "/workspace", icon: "home" },
      ...(allowed.has("follow-ups") || allowed.has("calendar") ? [{ id: "daily-follow-ups", label: tKey("Calendar"), href: "/workspace/crm/follow-ups?view=schedule", icon: "calendar" as const }] : []),
      ...(allowed.has("conversations") ? [{ id: "inbox", label: tKey("Inbox"), href: "/workspace/crm/conversations", icon: "conversations" as const }] : []),
    ] },
    { id: "work", label: tKey("Business"), items: [
      ...(salesEntry ? [{ id: "sales", label: tKey("Sales"), href: salesEntry.href, icon: "opportunities" as const }] : []),
      ...(allowed.has("customers") || allowed.has("projects-overview") ? [{ id: "clients", label: tKey("Clients"), href: allowed.has("customers") ? "/workspace/crm/customers" : "/workspace/projects/clients", icon: "customers" as const }] : []),
      ...(allowed.has("pre-projects") ? [{ id: "planning", label: tKey("Planning"), href: "/workspace/pre-projects", icon: "preProjects" as const }] : []),
      ...(allowed.has("projects-overview") ? [{ id: "projects", label: tKey("Projects"), href: "/workspace/projects", icon: "projects" as const }] : []),
      ...(allowed.has("global-finance") ? [{ id: "finance", label: tKey("Finance"), href: "/workspace/finance", icon: "commercial" as const }] : []),
    ] },
    { id: "operations", label: tKey("Operations"), items: [
      ...(allowed.has("global-purchasing") ? [{ id: "purchasing", label: tKey("Purchasing"), href: "/workspace/purchasing", icon: "procurement" as const }] : []),
      ...(allowed.has("global-inventory") ? [{ id: "inventory", label: tKey("Inventory"), href: "/workspace/inventory", icon: "materialPlan" as const }] : []),
      ...(allowed.has("global-factory") ? [{ id: "factory", label: tKey("Factory"), href: "/workspace/factory", icon: "production" as const }] : []),
    ] },
    { id: "utilities", label: tKey("Company"), items: [
      ...(peopleTabs(modules).slice(0, 1).map(tab => ({ id: "team", label: tKey("People"), description: tKey("Team, attendance and leave"), href: tab.href, icon: "members" as const }))),
      ...(allowed.has("pre-project-catalogs") ? [{ id: "resources", label: tKey("Catalog"), description: tKey("Shared items, materials and prices"), href: "/workspace/catalogs", icon: "materialPlan" as const }] : []),
      ...(modules.some(module => module.navigation.some(group => group.items.some(item => item.id === "gallery"))) ? [{ id: "gallery", label: tKey("Gallery"), description: tKey("Your brochure to share"), href: "/workspace/gallery", icon: "designs" as const }] : []),
      ...(allowed.has("integrations") ? [{ id: "integrations", label: tKey("Connections"), href: "/workspace/integrations", icon: "integrations" as const }] : []),
      ...(modules.find(module => module.id === "workspace")?.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false && !["integrations", "members", "teams", "roles"].includes(item.id)).sort((a, b) => Number(b.id === "company") - Number(a.id === "company")).slice(0, 1).map(item => ({ id: "settings", label: tKey("Settings"), href: item.href, icon: "settings" as const })) ?? []),
    ] },
  ];
  return sections.filter(section => section.items.length);
}

/** People's areas, in the top bar on every People page: the directory first, then teams, roles, and attendance and leave. */
export function peopleTabs(modules: WorkspaceModuleDefinition[]): { id: string; label: string; href: string }[] {
  const allowed = new Set(modules.flatMap(module => module.navigation.flatMap(group => group.items).map(item => item.id)));
  return [
    { id: "members", label: tKey("Directory"), href: "/workspace/members" },
    { id: "teams", label: tKey("Teams"), href: "/workspace/teams" },
    { id: "roles", label: tKey("Roles"), href: "/workspace/roles" },
    { id: "hrms-overview", label: tKey("Attendance & leave"), href: "/workspace/hrms" },
  ].filter(tab => allowed.has(tab.id));
}

/** The tabs on Home: the overview plus the person's own queues. */
export function homeTabs(modules: WorkspaceModuleDefinition[]): { id: string; label: string; href: string }[] {
  const allowed = new Set(modules.flatMap(module => module.navigation.flatMap(group => group.items).filter(item => item.showInSidebar !== false).map(item => item.id)));
  const projectTasks = allowed.has("projects-overview");
  return [
    { id: "overview", label: tKey("Overview"), href: "/workspace" },
    ...(projectTasks || allowed.has("follow-ups") ? [{ id: "tasks", label: tKey("Tasks"), href: projectTasks ? "/workspace/tasks" : "/workspace/crm/follow-ups?view=activity" }] : []),
    // Everyone has approvals waiting somewhere (quotes, payments, orders, bills, reports): the list is theirs.
    { id: "approvals", label: tKey("Approvals"), href: "/workspace/approvals" },
  ];
}
export const HOME_ROUTES = ["/workspace", "/workspace/tasks", "/workspace/approvals"];

export function productNavigationActive(pathname: string, query: URLSearchParams, sections: WorkspaceNavigationSection[]): string | undefined {
  const items = sections.flatMap(section => section.items);
  const exists = (id: string | undefined) => id && items.some(item => item.id === id) ? id : undefined;
  const nav = resolveWorkspaceRoute(pathname, query).nav;
  // Planning cases belong to Projects for people who reach them from a project.
  return exists(nav) ?? (nav === "planning" ? exists("projects") : undefined);
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
