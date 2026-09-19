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
  brandPalette?: "beige-black";
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
  email: string;
  name: string;
};

export const workspaceModules: WorkspaceModuleDefinition[] = [
  {
    description: "Company, team and workspace settings",
    href: "/workspace",
    icon: "workspace",
    id: "workspace",
    label: "Workspace",
    navigation: [
      {
        id: "workspace-company",
        label: "Company",
        items: [
          {
            href: "/workspace",
            icon: "company",
            id: "company",
            label: "Company profile",
          },
          {
            href: "/workspace/language",
            icon: "language",
            id: "workspace-language",
            label: "Workspace language",
          },
        ],
      },
      {
        id: "workspace-people",
        label: "Team & access",
        items: [
          {
            href: "/workspace/members",
            icon: "members",
            id: "members",
            label: "People",
          },
          {
            href: "/workspace/teams",
            icon: "teams",
            id: "teams",
            label: "Work groups",
            // Groups are persisted, but do not yet drive project ownership, work
            // assignment, capacity, or delivery. Keep the route available while
            // withholding it from the primary workspace navigation until it does.
            showInSidebar: false,
          },
          {
            href: "/workspace/roles",
            icon: "roles",
            id: "roles",
            label: "Roles & permissions",
          },
        ],
      },
      {
        id: "workspace-connections",
        label: "Connections",
        items: [
          {
            href: "/workspace/integrations",
            icon: "integrations",
            id: "integrations",
            label: "Integrations",
          },
          {
            href: "/workspace/settings/client-portal",
            icon: "settings",
            id: "client-portal-settings",
            label: "Client portal",
          },
        ],
      },
      {
        id: "workspace-account",
        label: "Account & billing",
        items: [
          {
            href: "/workspace/legal-entities",
            icon: "company",
            id: "business-records",
            label: "Business records",
          },
          {
            href: "/workspace/billing",
            icon: "billing",
            id: "billing",
            label: "Billing",
          },
          {
            href: "/workspace/organizations",
            icon: "companies",
            id: "organizations-account",
            label: "Manage workspaces",
            showInSidebar: false,
          },
          {
            href: "/workspace/settings/security",
            icon: "security",
            id: "security",
            label: "Sign-in security",
          },
          {
            href: "/workspace/settings/audit-logs",
            icon: "audit",
            id: "audit-log",
            label: "Audit history",
          },
        ],
      },
    ],
  },
  {
    description: "Enquiries, customer decisions and follow-through",
    href: "/workspace/crm",
    icon: "leads",
    id: "crm",
    label: "CRM",
    navigation: [
      {
        id: "crm-flow",
        label: "Sales flow",
        items: [
          { href: "/workspace/crm", icon: "home", id: "crm-overview", label: "Today" },
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
            label: "Opportunities",
          },
          {
            href: "/workspace/crm/customers",
            icon: "customers",
            id: "customers",
            label: "Customers",
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
          {
            href: "/workspace/crm/automations",
            icon: "automations",
            id: "automations",
            label: "Smart rules",
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
    label: "Pre-execution",
    navigation: [
      {
        id: "pre-project-primary",
        items: [
          {
            href: "/workspace/pre-projects",
            icon: "preProjects",
            id: "pre-projects",
            label: "Pre-execution cases",
            description: "CRM-linked opportunities, assignments, stages, and next actions.",
          },
          {href:"/workspace/pre-projects/master-data",icon:"materialPlan",id:"pre-project-catalogs",label:"Master Data",description:"Rooms, items, variants, materials and prices."},
          {href:"/workspace/pre-projects/supplier-offers",icon:"procurement",id:"pre-project-supplier-offers",label:"Supplier Offers",description:"Compare sourced costs, validity, lead time and evidence."},
          {href:"/workspace/pre-projects/quotation-templates",icon:"documents",id:"quotation-templates",label:"Quotation Templates",description:"Reusable quotation rooms, items, rates and terms."},
        ],
      },
      {
        id: "pre-project-requirements",
        label: "Requirement gathering",
        items: [
          {href:"/workspace/pre-projects/overview",icon:"home",id:"pre-project-case-overview",label:"Case overview",description:"Owner, target, priority, risk and current stage."},
          {href:"/workspace/pre-projects/requirements",icon:"requirements",id:"requirements",label:"Requirements",description:"Client brief, notes, room scope, measurements and site layouts in one workspace."},
        ],
      },
      {
        id: "pre-project-case-sections",
        items: [
          {href:"/workspace/pre-projects/inspiration",icon:"designs",id:"pre-project-inspiration",label:"Client inspirations",description:"Client ideas, images and reference links."},
          {href:"/workspace/pre-projects/designs",icon:"designs",id:"pre-project-designs",label:"Design",description:"Design files, versions and client feedback."},
          {href:"/workspace/pre-projects/definition",icon:"requirements",id:"pre-project-definition",label:"Scope confirmation",description:"Agree the current requirements and design definition with the client."},
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
    navigation: [
      {
        id: "projects-control",
        label: "Project control",
        items: [
          { href: "/workspace/projects", icon: "home", id: "projects-overview", label: "Portfolio overview", description: "Live delivery progress, milestones, blockers and decisions." },
          { href: "/workspace/projects/calendar", icon: "calendar", id: "projects-calendar", label: "Portfolio calendar", description: "Projects, resources, site visits and confirmed work in one schedule." },
          { href: "/workspace/projects/commercial", icon: "commercial", id: "project-commercial", label: "Budget", description: "Approved budget, forecast, costs and payments." },
        ],
      },
      {
        id: "projects-plan",
        label: "Plan",
        items: [
          { href: "/workspace/projects/documents", icon: "designs", id: "project-documents", label: "Scope & Design", description: "Drawings, revisions and approved project documents." },
          { href: "/workspace/projects/boq", icon: "boq", id: "project-boq", label: "BOQ", description: "Released scope items, quoted sizes and delivery coverage." },
          { href: "/workspace/projects/material-planning", icon: "materialPlan", id: "material-planning", label: "Material planning", description: "Requirements, stock, reservations and warehouse transfers." },
          { href: "/workspace/projects/procurement", icon: "procurement", id: "procurement", label: "Procurement", description: "Supplier enquiries, purchase orders, receipts and returns." },
          { href: "/workspace/projects/plan-teams", icon: "calendar", id: "plan-teams", label: "Schedules", description: "Task dates, milestones, dependencies, calendars and bookings." },
        ],
      },
      {
        id: "projects-deliver",
        label: "Deliver",
        items: [
          { href: "/workspace/projects/production", icon: "production", id: "production", label: "Production", description: "Factory work, approvals, output and dispatch readiness." },
          { href: "/workspace/projects/site-work", icon: "installation", id: "site-work", label: "Onsite execution", description: "Site readiness, installation, commissioning and technical queries." },
          { href: "/workspace/projects/daily-progress", icon: "reports", id: "daily-progress", label: "Daily progress", description: "Field reports, evidence, workforce, blockers and review." },
        ],
      },
      {
        id: "projects-close",
        label: "Quality & close",
        items: [
          { href: "/workspace/projects/snagging", icon: "snagging", id: "snagging", label: "Snagging & warranty", description: "Defects, verification, closure and aftercare." },
          { href: "/workspace/projects/handover", icon: "handover", id: "handover", label: "Handover", description: "Client acceptance, completion records and warranties." },
          { href: "/workspace/projects/workflow-templates", icon: "settings", id: "project-workflow-templates", label: "Workflow setup", description: "Reusable project stages, owners and release checks." },
        ],
      },
    ],
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
