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
  description?: string;
  href: string;
  icon: WorkspaceIconName;
  id: string;
  label: string;
  showInSidebar?: boolean;
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
};

export type WorkspaceUser = {
  avatarUrl?: string;
  email: string;
  name: string;
  platformRole?: "administrator" | null;
};

export const workspaceModules: WorkspaceModuleDefinition[] = [
  {
    description: "Company setup and administration",
    href: "/workspace",
    icon: "workspace",
    id: "workspace",
    label: "Workspace",
    navigation: [
      {
        id: "workspace-organization",
        label: "Organization",
        items: [
          {
            href: "/workspace",
            icon: "company",
            id: "company",
            label: "Org profile",
          },
          {
            href: "/workspace/members",
            icon: "members",
            id: "members",
            label: "Members",
          },
          {
            href: "/workspace/teams",
            icon: "teams",
            id: "teams",
            label: "Teams and business units",
          },
          {
            href: "/workspace/roles",
            icon: "roles",
            id: "roles",
            label: "Roles and permissions",
          },
        ],
      },
      {
        id: "workspace-administration",
        label: "Administration",
        items: [
          {
            href: "/workspace/integrations",
            icon: "integrations",
            id: "integrations",
            label: "Integrations",
          },
          {
            href: "/workspace/settings/audit-logs",
            icon: "audit",
            id: "audit-log",
            label: "Audit Logs",
            showInSidebar: false,
          },
          {
            href: "/workspace/settings/security",
            icon: "security",
            id: "security",
            label: "Security",
            showInSidebar: false,
          },
          {
            href: "/workspace/billing",
            icon: "billing",
            id: "billing",
            label: "Billing",
          },
          {
            href: "/workspace/settings/client-portal",
            icon: "settings",
            id: "client-portal-settings",
            label: "Client portal",
            showInSidebar: false,
          },
          {
            href: "/workspace/settings",
            icon: "settings",
            id: "settings",
            label: "User Settings",
          },
        ],
      },
    ],
  },
  {
    description: "Customers, leads and opportunities",
    href: "/workspace/crm",
    icon: "leads",
    id: "crm",
    label: "CRM",
    navigation: [
      {
        id: "crm-primary",
        items: [
          { href: "/workspace/crm", icon: "home", id: "crm-overview", label: "Overview" },
          { href: "/workspace/crm/leads", icon: "leads", id: "leads", label: "Leads" },
          {
            href: "/workspace/crm/follow-ups",
            icon: "followUps",
            id: "follow-ups",
            label: "Follow-ups",
          },
          {
            href: "/workspace/crm/calendar",
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
        ],
      },
      {
        id: "crm-sales-records",
        label: "Customers & sales",
        items: [
          {
            href: "/workspace/crm/customers",
            icon: "customers",
            id: "customers",
            label: "People",
            showInSidebar: false,
          },
          {
            href: "/workspace/crm/organizations",
            icon: "companies",
            id: "organizations",
            label: "Companies",
            showInSidebar: false,
          },
          {
            href: "/workspace/crm/opportunities",
            icon: "opportunities",
            id: "opportunities",
            label: "Deals",
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
        id: "crm-automation",
        label: "Automation",
        items: [
          {
            href: "/workspace/crm/sequences",
            icon: "sequences",
            id: "sequences",
            label: "Sequences",
            showInSidebar: false,
          },
          {
            href: "/workspace/crm/automations",
            icon: "automations",
            id: "automations",
            label: "Automations",
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
            label: "CRM reports",
            showInSidebar: false,
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
    label: "Pre-execution",
    navigation: [
      {
        id: "pre-project-primary",
        items: [
          {
            href: "/workspace/pre-projects",
            icon: "preProjects",
            id: "pre-projects",
            label: "Qualified leads",
            description: "CRM-linked cases, assignments, stages, and next actions.",
          },
          {href:"/workspace/pre-projects/master-data",icon:"materialPlan",id:"pre-project-catalogs",label:"Master Data",description:"Rooms, items, variants, materials and prices."},
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
          {href:"/workspace/pre-projects/inspiration",icon:"designs",id:"pre-project-inspiration",label:"Client inspirations",description:"Client ideas, images and reference links."},
          {href:"/workspace/pre-projects/designs",icon:"designs",id:"pre-project-designs",label:"Design",description:"Design files, versions and client feedback."},
          {href:"/workspace/pre-projects/quotations",icon:"commercial",id:"pre-project-quotations",label:"Quotations",description:"Client quotations, pricing and revisions."},
          {href:"/workspace/pre-projects/contracts",icon:"contracts",id:"pre-project-contracts",label:"Agreement & payments",description:"Signed agreement, milestones, accounting evidence and receipts."},
          {href:"/workspace/pre-projects/variations",icon:"variations",id:"pre-project-variations",label:"Change requests",description:"Client changes, commercial impact and resolution."},
          {href:"/workspace/pre-projects/execution-release",icon:"executionRelease",id:"pre-project-release",label:"Approvals & release",description:"Owner review, Deal File, material selections and execution gates."},
          {href:"/workspace/pre-projects/client-portal",icon:"customers",id:"pre-project-client-portal",label:"Client portal",description:"Client access and shared information."},
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
    navigation: [{
      id: "projects-primary",
      items: [
        { href: "/workspace/projects", icon: "home", id: "projects-overview", label: "Dashboard", description: "Live delivery progress, milestones, blockers and decisions." },
        { href: "/workspace/projects/documents", icon: "designs", id: "project-documents", label: "Scope & Design", description: "Drawings, revisions and approved project documents." },
        { href: "/workspace/projects/boq", icon: "boq", id: "project-boq", label: "BOQ", description: "Released scope items, materials and quantities." },
        { href: "/workspace/projects/procurement", icon: "procurement", id: "procurement", label: "Procurement", description: "Supplier enquiries, purchase orders and deliveries." },
        { href: "/workspace/projects/plan-teams", icon: "calendar", id: "plan-teams", label: "Schedules", description: "Task dates, milestones, work calendars and team bookings." },
        { href: "/workspace/projects/site-work", icon: "installation", id: "site-work", label: "Execution", description: "Tasks, readiness, site work and inspections." },
        { href: "/workspace/projects/handover", icon: "handover", id: "handover", label: "Handover", description: "Client acceptance, completion records and warranties." },
        { href: "/workspace/projects/commercial", icon: "commercial", id: "project-commercial", label: "Budget", description: "Approved budget, forecast, costs and payments." },
      ],
    }],
  },
  {
    description: "Attendance, sites and leave",
    href: "/workspace/hrms", icon: "members", id: "hrms", label: "HRMS",
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
  return (
    screens.find((item) => item.href === pathname) ??
    activeModule.navigation[0]?.items[0] ??
    screens[0]
  );
}
