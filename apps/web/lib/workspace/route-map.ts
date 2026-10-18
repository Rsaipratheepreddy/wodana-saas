import { workspaceModules } from "@/components/workspace/workspace-navigation";

/**
 * One map of workspace routes: each route's name, its parent in the breadcrumb, the sidebar entry it
 * highlights and whether it is a Settings page. The breadcrumb, the active sidebar item, the Settings
 * gear and the window title all read it, so they can't disagree.
 */
export type WorkspaceRouteEntry = {
  id: string;
  /** The page's name: an English key of en.json, translated where it's shown. */
  label: string;
  /** Where the breadcrumb links when this route is an ancestor. */
  href: string;
  /** The route above it in the breadcrumb. */
  parent?: string;
  /** The sidebar entry (see `productNavigation`) it highlights; inherited from the parent when absent. */
  nav?: string;
  /** A Settings page: the Settings gear is active and the Settings menu shows. Inherited from the parent. */
  settings?: boolean;
  /** Named by the Home tabs, so the breadcrumb stops at its parent. */
  homeTab?: boolean;
  /** A page named after its record (a planning case, a project) once the record has loaded. */
  record?: boolean;
  /** Matched exactly or as a prefix followed by "/". */
  paths?: string[];
  /** Matched when the whole path fits. */
  pattern?: RegExp;
  /** Only when one of these query values is present. */
  query?: Record<string, string[]>;
  exact?: boolean;
};

export type WorkspaceRoute = Omit<WorkspaceRouteEntry, "paths" | "pattern" | "query" | "exact"> & {
  /** The ancestors, outermost first. */
  trail: Array<{ id: string; label: string; href: string }>;
};

const SETTINGS_NAV_OVERRIDES: Record<string, Partial<WorkspaceRouteEntry>> = {
  // Connections has its own sidebar entry as well as a place in the Settings menu.
  integrations: { nav: "integrations" },
};

/** Settings menu entries whose pages belong to People: the menu links to them, the pages show People's tabs. */
const PEOPLE_PAGES = ["members", "teams", "roles"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Built on first use: the navigation module also reads this map, so nothing runs at import time.
let cache: { routes: WorkspaceRouteEntry[]; byId: Map<string, WorkspaceRouteEntry> } | null = null;

/** Every workspace route, most general first. */
export function workspaceRoutes(): WorkspaceRouteEntry[] {
  return routeTable().routes;
}

function routeTable() {
  if (cache) return cache;
  const settingsModule = workspaceModules.find((module) => module.id === "workspace");
  const settingsEntries: WorkspaceRouteEntry[] = (settingsModule?.navigation ?? [])
    .flatMap((group) => group.items)
    // Gallery sits in the Company section of the sidebar and Reports and Ledger under Business, not in Settings; People, Teams and Roles live in People.
    .filter((item) => !["gallery", "management-reports", "ledger", ...PEOPLE_PAGES].includes(item.id))
    .map((item) => ({ id: `settings:${item.id}`, label: item.label, href: item.href, parent: "settings", paths: [item.href], ...SETTINGS_NAV_OVERRIDES[item.id] }));
  const hrmsModule = workspaceModules.find((module) => module.id === "hrms");
  const hrmsEntries: WorkspaceRouteEntry[] = (hrmsModule?.navigation ?? [])
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/workspace/hrms")
    .map((item) => ({ id: `people:${item.id}`, label: item.label, href: item.href, parent: "people", paths: [item.href] }));
  const routes: WorkspaceRouteEntry[] = [
    // Daily work
    { id: "home", label: "Home", href: "/workspace", nav: "home", paths: ["/workspace"], exact: true },
    // Everything due on the person across the modules (plan §6.24a).
    { id: "my-day", label: "My day", href: "/workspace/my-day", parent: "home", homeTab: true, paths: ["/workspace/my-day"] },
    // PLM-150: a design inspection at the factory (opened from My day, its notice or the work order).
    { id: "inspection", label: "Design inspection", href: "/workspace/my-day", parent: "my-day", paths: ["/workspace/inspections"] },
    { id: "tasks", label: "Tasks", href: "/workspace/tasks", parent: "home", homeTab: true, paths: ["/workspace/tasks"] },
    { id: "approvals", label: "Approvals", href: "/workspace/approvals", parent: "home", homeTab: true, paths: ["/workspace/approvals"] },
    // A change an AI app prepared, waiting for the person's OK (opened from Approvals or its notice).
    { id: "ai-action", label: "Waiting for your OK", href: "/workspace/approvals", parent: "approvals", paths: ["/workspace/ai-actions"] },
    // A timeline question asked of the design team or Production (PLM-155), opened from My day or its notice.
    { id: "timeline-check", label: "Timeline question", href: "/workspace/my-day", parent: "my-day", paths: ["/workspace/timeline-checks"] },
    // A case's client portal as the client sees it (read-only preview; no workspace chrome).
    { id: "client-view", label: "Client view", href: "/workspace/pre-projects", parent: "home", paths: ["/workspace/client-view"] },
    // Sales people without project tasks get their follow-ups as Home › Follow-ups.
    { id: "sales-tasks", label: "Follow-ups", href: "/workspace/crm/follow-ups?view=activity", parent: "home", homeTab: true, paths: ["/workspace/crm/follow-ups"], query: { view: ["activity"] } },
    { id: "calendar", label: "Calendar", href: "/workspace/crm/follow-ups?view=schedule", nav: "daily-follow-ups", paths: ["/workspace/crm/follow-ups"], query: { view: ["schedule", "calendar"] } },
    { id: "calendar-legacy", label: "Calendar", href: "/workspace/crm/follow-ups?view=schedule", nav: "daily-follow-ups", paths: ["/workspace/crm/calendar"] },
    // The pages people book time on (Calendly-style) belong to the calendar: Calendar › Booking pages.
    { id: "booking-pages", label: "Booking pages", href: "/workspace/crm/booking-types", parent: "calendar", paths: ["/workspace/crm/booking-types"] },
    { id: "inbox", label: "Inbox", href: "/workspace/crm/conversations", nav: "inbox", paths: ["/workspace/crm/conversations"] },
    // Every notice, opened from the bell.
    { id: "notifications", label: "Notifications", href: "/workspace/notifications", parent: "home", paths: ["/workspace/notifications"] },

    // Business
    { id: "enquiry-types", label: "Enquiry types", href: "/workspace/enquiry-types", nav: "enquiry-types", paths: ["/workspace/enquiry-types", "/workspace/flows"] },
    { id: "enquiry-type", label: "Enquiry type", href: "/workspace/enquiry-types", parent: "enquiry-types", record: true, pattern: new RegExp(`^/workspace/enquiry-types/${UUID}$`, "i") },
    { id: "sales", label: "Sales", href: "/workspace/crm", nav: "sales", paths: ["/workspace/crm"] },
    { id: "enquiries", label: "Enquiries", href: "/workspace/crm/leads", parent: "sales", paths: ["/workspace/crm/leads"] },
    { id: "campaigns", label: "Campaigns", href: "/workspace/crm/leads?section=forms", parent: "sales", paths: ["/workspace/crm/leads"], query: { section: ["forms", "sources"] } },
    { id: "sales-reports", label: "Reports", href: "/workspace/crm/leads?section=reports", parent: "sales", paths: ["/workspace/crm/leads"], query: { section: ["reports"] } },
    { id: "sales-reports-legacy", label: "Reports", href: "/workspace/crm/leads?section=reports", parent: "sales", paths: ["/workspace/crm/reports"] },
    { id: "sales-settings", label: "Settings", href: "/workspace/crm/leads?section=assignment", parent: "sales", paths: ["/workspace/crm/leads"], query: { section: ["assignment", "sla", "options", "automations"] } },
    { id: "sales-automations", label: "Settings", href: "/workspace/crm/leads?section=automations", parent: "sales", paths: ["/workspace/crm/automations"] },
    { id: "pipeline", label: "Pipeline", href: "/workspace/crm/opportunities", parent: "sales", paths: ["/workspace/crm/opportunities"] },
    { id: "follow-ups", label: "Follow-ups", href: "/workspace/crm/follow-ups", parent: "sales", paths: ["/workspace/crm/follow-ups", "/workspace/crm/activities"] },
    { id: "attachments", label: "Attachments", href: "/workspace/crm/attachments", parent: "sales", paths: ["/workspace/crm/attachments"] },
    { id: "clients", label: "Clients", href: "/workspace/crm/customers", nav: "clients", paths: ["/workspace/crm/customers", "/workspace/crm/organizations", "/workspace/projects/clients"] },
    { id: "jobs", label: "Jobs", href: "/workspace/jobs", nav: "jobs", paths: ["/workspace/jobs"] },
    { id: "team-chat", label: "Team chat", href: "/workspace/team-chat", nav: "team-chat", paths: ["/workspace/team-chat"] },
    { id: "job", label: "Job", href: "/workspace/jobs", parent: "jobs", record: true, pattern: new RegExp(`^/workspace/jobs/${UUID}(/|$)`, "i") },
    { id: "planning", label: "Planning", href: "/workspace/pre-projects", nav: "planning", paths: ["/workspace/pre-projects"] },
    { id: "planning-case", label: "Planning", href: "/workspace/pre-projects", parent: "planning", record: true, paths: ["/workspace/pre-projects/cases"] },
    { id: "quotation-templates", label: "Quotation templates", href: "/workspace/pre-projects/quotation-templates", parent: "planning", paths: ["/workspace/pre-projects/quotation-templates"] },
    { id: "supplier-offers", label: "Supplier offers", href: "/workspace/pre-projects/supplier-offers", parent: "planning", paths: ["/workspace/pre-projects/supplier-offers"] },
    { id: "sample-library", label: "Sample library", href: "/workspace/pre-projects/samples", parent: "planning", paths: ["/workspace/pre-projects/samples"] },
    { id: "catalog", label: "Catalog", href: "/workspace/catalogs", nav: "resources", paths: ["/workspace/catalogs", "/workspace/pre-projects/catalogs", "/workspace/pre-projects/master-data"] },
    { id: "projects", label: "Projects", href: "/workspace/projects", nav: "projects", paths: ["/workspace/projects"] },
    { id: "project", label: "Project", href: "/workspace/projects", parent: "projects", record: true, pattern: new RegExp(`^/workspace/projects/${UUID}(/|$)`, "i") },
    { id: "projects-profitability", label: "Profitability", href: "/workspace/projects/profitability", parent: "projects", paths: ["/workspace/projects/profitability"] },
    { id: "finance", label: "Finance", href: "/workspace/finance", nav: "finance", paths: ["/workspace/finance"] },
    { id: "reports", label: "Reports", href: "/workspace/reports", nav: "reports", paths: ["/workspace/reports"] },
    // The Ledger: its reports, journals and accounts are tabs of one page (/workspace/ledger/<tab>/<record>).
    { id: "ledger", label: "Ledger", href: "/workspace/ledger", nav: "ledger", paths: ["/workspace/ledger"] },

    // Operations
    { id: "purchasing", label: "Purchasing", href: "/workspace/purchasing", nav: "purchasing", paths: ["/workspace/purchasing"] },
    // Scanning an order's or a move's code to receive it (the code printed on the order opens here).
    { id: "receive", label: "Receive", href: "/workspace/receive", parent: "purchasing", paths: ["/workspace/receive"] },
    { id: "inventory", label: "Inventory", href: "/workspace/inventory", nav: "inventory", paths: ["/workspace/inventory"] },
    { id: "factory", label: "Factory", href: "/workspace/factory", nav: "factory", paths: ["/workspace/factory"] },
    // Factory's Calendar tab (its own sidebar entry, Logistics): the breadcrumb says Factory and the tab names it.
    { id: "logistics-calendar", label: "Logistics calendar", href: "/workspace/factory/calendar", parent: "factory", nav: "logistics-calendar", paths: ["/workspace/factory/calendar"] },

    // Company: People opens on the directory; teams, roles, and attendance and leave are its other areas.
    { id: "people", label: "People", href: "/workspace/members", nav: "team", paths: ["/workspace/members"] },
    { id: "people:teams", label: "Teams", href: "/workspace/teams", parent: "people", paths: ["/workspace/teams"] },
    { id: "people:roles", label: "Roles & permissions", href: "/workspace/roles", parent: "people", paths: ["/workspace/roles"] },
    { id: "people:attendance", label: "Attendance", href: "/workspace/hrms", parent: "people", paths: ["/workspace/hrms"] },
    ...hrmsEntries,
    { id: "gallery", label: "Gallery", href: "/workspace/gallery", nav: "gallery", paths: ["/workspace/gallery"] },
    { id: "settings", label: "Settings", href: "/workspace/settings/profile", nav: "settings", settings: true, paths: ["/workspace/settings"] },
    ...settingsEntries,
  ];
  cache = { routes, byId: new Map(routes.map((entry) => [entry.id, entry])) };
  return cache;
}

function score(entry: WorkspaceRouteEntry, pathname: string, query: URLSearchParams): number {
  if (entry.query && !Object.entries(entry.query).every(([key, values]) => values.includes(query.get(key) ?? ""))) return -1;
  const bonus = entry.query ? 0.5 : 0;
  if (entry.pattern?.test(pathname)) return 1000 + bonus;
  const lengths = (entry.paths ?? []).filter((path) => pathname === path || (!entry.exact && pathname.startsWith(`${path}/`))).map((path) => path.length);
  return lengths.length ? Math.max(...lengths) + bonus : -1;
}

/** The route a workspace address belongs to, with its breadcrumb trail and what it highlights. */
export function resolveWorkspaceRoute(pathname: string, query: URLSearchParams = new URLSearchParams()): WorkspaceRoute {
  let best: WorkspaceRouteEntry | undefined;
  let bestScore = -1;
  const { routes, byId } = routeTable();
  for (const entry of routes) {
    const value = score(entry, pathname, query);
    if (value > bestScore) { best = entry; bestScore = value; }
  }
  const entry = best ?? { id: "unknown", label: "Home", href: "/workspace" };
  const trail: WorkspaceRoute["trail"] = [];
  let nav = entry.nav;
  let settings = entry.settings;
  for (let parent = entry.parent ? byId.get(entry.parent) : undefined; parent; parent = parent.parent ? byId.get(parent.parent) : undefined) {
    trail.unshift({ id: parent.id, label: parent.label, href: parent.href });
    nav ??= parent.nav;
    settings ??= parent.settings;
  }
  const { paths: _paths, pattern: _pattern, query: _query, exact: _exact, ...rest } = entry;
  void _paths; void _pattern; void _query; void _exact;
  return { ...rest, nav, settings: Boolean(settings), trail };
}
