import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HomeMetrics, HomeSummary } from "@wodana/contracts";
import { WorkspaceHome } from "./workspace-home";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/crm/follow-up-editor", () => ({
  FollowUpSheet: ({ recordId }: { recordId: string }) => <div>Editing follow-up {recordId}</div>,
  NewFollowUpDialog: () => <div>Create follow-up in place</div>,
}));
vi.mock("@/components/project-core/work-sheet", () => ({ WorkSheet: ({ itemId }: { itemId: string }) => <div>Work item {itemId}</div> }));
vi.mock("@/lib/project-core/client", () => ({ projectApi: () => ({ work: vi.fn(async () => ({ items: [] })) }) }));
vi.mock("./home-attendance", () => ({ HomeAttendance: () => <span>Attendance chip</span> }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

const base = { workspaceId: "00000000-0000-4000-8000-000000000001", userId: "user", workspaceName: "Palm Living", modules: ["crm", "pre-project", "projects", "hrms"] };
const weeks = (value: (index: number) => string) => Array.from({ length: 8 }, (_, index) => ({ start: new Date(Date.UTC(2026, 7, 3 + index * 7)).toISOString().slice(0, 10), value: value(index), count: index }));

const summary: HomeSummary = {
  generatedAt: "2026-09-28T06:00:00Z", timeZone: "UTC", today: "2026-09-28",
  focus: { total: 8, items: [
    { id: "work:w-1", source: "work", urgency: "overdue", recordId: "w-1", projectId: "p-1", title: "Shop drawings", context: "Villa 12", due: "2026-09-25", href: "/workspace/projects/p-1/plan?item=w-1" },
    { id: "follow_up:f-1", source: "follow_up", urgency: "overdue", recordId: "f-1", title: "Call Amira back", context: "Amira", due: "2026-09-27T06:00:00Z", href: "/workspace/crm/follow-ups?record=f-1" },
    { id: "follow_up:f-2", source: "follow_up", urgency: "today", recordId: "f-2", title: "Send the brochure", context: "Omar", due: "2026-09-28T15:00:00Z", href: "/workspace/crm/follow-ups?record=f-2" },
    { id: "quote_review:q-1", source: "quote_review", urgency: "waiting", recordId: "q-1", title: "The Penthouse", context: "Layla Haddad", due: "2026-09-20T08:00:00Z", href: "/workspace/pre-projects/cases/c-1/quotations?quote=q-1" },
    { id: "receipt:r-1", source: "receipt", urgency: "waiting", recordId: "r-1", title: "Ranches Townhouse", context: "Faris", due: null, href: "/workspace/pre-projects/cases/c-2/approvals" },
    { id: "order_approval:o-1", source: "order_approval", urgency: "waiting", recordId: "o-1", title: "PALM-PO-17", context: "Oak & Co", due: null, href: "/workspace/purchasing/orders?order=o-1" },
    { id: "leave:l-1", source: "leave", urgency: "waiting", recordId: "l-1", title: "Rami", context: "Annual leave", due: null, href: "/workspace/hrms/team" },
    { id: "petty_cash:pc-1", source: "petty_cash", urgency: "waiting", recordId: "pc-1", title: "Rami", context: "Ranches", due: null, href: "/workspace/projects/p-2/petty-cash?claim=pc-1" },
  ] },
  upcoming: [
    { id: "meeting:m-1", kind: "meeting", title: "Site visit - Dubai Hills", context: "Amira", at: "2026-09-29T06:30:00Z", allDay: false, href: "/workspace/crm/follow-ups?record=a-1" },
    { id: "delivery:po-2", kind: "delivery", title: "PALM-PO-11", context: "Oak & Co", at: "2026-10-02", allDay: true, href: "/workspace/purchasing/orders?order=po-2" },
  ],
  horizonDays: 7,
  funnel: [
    { id: "enquiries", count: 11, stuck: 5, href: "/workspace/crm/leads" },
    { id: "planning", count: 6, stuck: 0, href: "/workspace/pre-projects" },
    { id: "quotes", count: 3, stuck: 0, href: "/workspace/pre-projects?section=quotations" },
    { id: "projects", count: 3, stuck: 1, href: "/workspace/projects" },
    { id: "handover", count: 0, stuck: 0, href: "/workspace/projects" },
  ],
  recent: [
    { id: "p-1", kind: "project", title: "Villa 12", context: "PRJ-0001", at: "2026-09-27T10:00:00Z", href: "/workspace/projects/p-1" },
    { id: "l-1", kind: "enquiry", title: "Amira", context: "Kitchen", at: "2026-09-26T10:00:00Z", href: "/workspace/crm/leads?lead=l-1" },
  ],
  projects: [{ id: "p-1", name: "Villa 12" }, { id: "p-2", name: "Ranches Townhouse" }],
};
const metrics: HomeMetrics = {
  generatedAt: "2026-09-28T06:00:00Z", timeZone: "UTC", weekStartsOn: 1, currency: "EUR",
  enquiries: { current: 12, previous: 10, weekly: weeks((index) => String(index)) },
  quotes: { issuedValue: "900.00", previousIssuedValue: "0.00", issuedCount: 1, accepted: 0, previousAccepted: 0, awaiting: 3, weekly: weeks(() => "100.00") },
  payments: { received: "1500.50", previousReceived: "3001.00", due: "500.00", weekly: weeks(() => "10.00") },
  projects: { active: 4, overdueTasks: 3, onTrack: 2, atRisk: 1, late: 1, weekly: weeks(() => "0") },
  activity: [{ id: "e-1", area: "projects", action: "project.updated", subject: "Villa 12", actorName: "Maya", at: "2026-09-28T05:00:00Z", href: "/workspace/projects/p-1" }],
};

function api({ home = summary as HomeSummary | null, figures = metrics as HomeMetrics | null } = {}) {
  const fetcher = vi.fn(async (url: string) => {
    const body = url.includes("home-summary") ? home : url.includes("home-metrics") ? figures : { items: [], truncated: false };
    return { ok: body !== null, status: body === null ? 500 : 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const owner = ["crm.leads.manage", "crm.leads.view", "crm.activities.manage", "crm.activities.view", "pre_projects.view", "pre_projects.create", "projects.view", "projects.manage", "projects.report", "receivables.view", "purchasing.view", "purchasing.manage", "audit.view", "workspace.settings.manage"];

it("keeps the page anatomy: one title, one primary action, search in reach and the product-tour anchors", async () => {
  api(); render(<WorkspaceHome {...base} firstName="Maya" permissions={owner} />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Maya/);
  expect(screen.getByRole("link", { name: "New enquiry" })).toHaveAttribute("data-variant", "primary");
  expect(screen.getByRole("searchbox", { name: "Search workspace" }).closest("[data-tour]")).toHaveAttribute("data-tour", "home-edit");
  expect(screen.getByRole("region", { name: /^Today/ })).toHaveAttribute("data-tour", "home-widget-attention");
  expect(screen.queryByRole("button", { name: "Edit Home" })).not.toBeInTheDocument();
  expect(screen.getByText("Attendance chip").closest("header")).toHaveClass("wd-page-header");
});

it("lists what needs the person, late first, each with one action; follow-ups and work open in place", async () => {
  api(); render(<WorkspaceHome {...base} permissions={owner} />);
  const today = await screen.findByRole("region", { name: /^Today/ });
  await within(today).findByText("Shop drawings");
  const rows = within(today).getAllByRole("listitem");
  expect(rows).toHaveLength(6);
  expect(rows.map((row) => row.getAttribute("data-urgency"))).toEqual(["overdue", "overdue", "today", "waiting", "waiting", "waiting"]);
  expect(rows[0]).toHaveTextContent("3 days late");
  expect(rows[3]).toHaveTextContent("Quote review · Layla Haddad");
  expect(within(rows[3]).getByRole("link", { name: "Review: The Penthouse" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c-1/quotations?quote=q-1");
  fireEvent.click(within(rows[1]).getByRole("button", { name: "Update: Call Amira back" }));
  expect(screen.getByText("Editing follow-up f-1")).toBeVisible();
  fireEvent.click(within(rows[0]).getByRole("button", { name: "Open: Shop drawings" }));
  expect(await screen.findByText("Work item w-1")).toBeVisible();
  fireEvent.click(within(today).getByRole("button", { name: "Show all 8" }));
  expect(within(today).getAllByRole("listitem")).toHaveLength(8);
});

it("says the person is all caught up and still shows what's next", async () => {
  api({ home: { ...summary, focus: { items: [], total: 0 } } }); render(<WorkspaceHome {...base} permissions={["crm.activities.manage", "crm.activities.view"]} />);
  const today = await screen.findByRole("region", { name: /^Today/ });
  expect(await within(today).findByText("You're all caught up")).toBeVisible();
  expect(within(today).getByRole("link", { name: /Next: Site visit - Dubai Hills/ })).toHaveAttribute("href", "/workspace/crm/follow-ups?record=a-1");
  fireEvent.click(within(today).getByRole("button", { name: "Plan follow-up" }));
  expect(screen.getByText("Create follow-up in place")).toBeVisible();
});

it("shows the pipeline the person can see with counts, and marks the stages that have stalled", async () => {
  api(); render(<WorkspaceHome {...base} permissions={owner} />);
  const pipeline = await screen.findByRole("region", { name: "Pipeline" });
  const stages = await within(pipeline).findAllByRole("link");
  expect(stages.map((stage) => stage.getAttribute("aria-label"))).toEqual(["Enquiries, 11, 5 stalled", "Planning, 6", "Quotes, 3", "Projects, 3, 1 stalled", "Handover, 0"]);
  expect(stages[0]).toHaveAttribute("data-stalled", "true");
  expect(stages[1]).not.toHaveAttribute("data-stalled");
});

it("hides the pipeline when the person can see none of its stages", async () => {
  api({ home: { ...summary, funnel: [] } }); render(<WorkspaceHome {...base} permissions={["factory.report"]} />);
  await screen.findByRole("region", { name: /^Coming up/ });
  expect(screen.queryByRole("region", { name: "Pipeline" })).not.toBeInTheDocument();
});

it("shows one or two numbers for the role, each linking to its list", async () => {
  api(); const { unmount } = render(<WorkspaceHome {...base} canManage permissions={owner} />);
  let numbers = await screen.findByRole("navigation", { name: "Key numbers" });
  expect(within(numbers).getAllByRole("link").map((link) => link.getAttribute("data-figure"))).toEqual(["money-in", "projects"]);
  expect(within(numbers).getByRole("link", { name: /Money in this month/ })).toHaveTextContent("50% down on last month");
  expect(within(numbers).getByRole("link", { name: /Projects on track/ })).toHaveTextContent("2 of 4");
  unmount();
  api(); render(<WorkspaceHome {...base} permissions={["crm.leads.view", "crm.leads.manage", "pre_projects.view", "projects.view"]} />);
  numbers = await screen.findByRole("navigation", { name: "Key numbers" });
  expect(within(numbers).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/workspace/crm/leads", "/workspace/pre-projects?section=quotations"]);
  expect(within(numbers).getByRole("link", { name: /New enquiries this month/ })).toHaveTextContent("20% up on last month");
});

it("offers only the quick actions the role can do, with project actions choosing the project", async () => {
  api(); const { unmount } = render(<WorkspaceHome {...base} permissions={["factory.report", "projects.view", "projects.report"]} />);
  const actions = await screen.findByRole("group", { name: "Quick actions" });
  await waitFor(() => expect(within(actions).getByRole("button", { name: /Site report/ })).toBeInTheDocument());
  expect(within(actions).getAllByRole("button").map((button) => button.textContent)).toEqual(["New task", "Site report"]);
  expect(within(actions).getByRole("link", { name: "Report output" })).toHaveAttribute("href", "/workspace/factory");
  expect(screen.queryByRole("link", { name: "New enquiry" })).not.toBeInTheDocument();
  unmount();
  api(); render(<WorkspaceHome {...base} modules={["workspace"]} permissions={["receivables.view", "payables.manage"]} />);
  const finance = await screen.findByRole("group", { name: "Quick actions" });
  expect(within(finance).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/workspace/finance/client-invoices", "/workspace/finance/payments"]);
});

it("links a project action straight to the project when the person has one", async () => {
  api({ home: { ...summary, projects: [{ id: "p-1", name: "Villa 12" }] } }); render(<WorkspaceHome {...base} permissions={["projects.view", "projects.report"]} />);
  expect(await screen.findByRole("link", { name: "Site report" })).toHaveAttribute("href", "/workspace/projects/p-1/site?new=report");
  expect(screen.getByRole("link", { name: "New task" })).toHaveAttribute("href", "/workspace/projects/p-1/plan?new=task");
});

it("lists what's coming up on the workspace calendar and the records to jump back into", async () => {
  api(); render(<WorkspaceHome {...base} permissions={owner} />);
  const upcoming = await screen.findByRole("region", { name: /^Coming up/ });
  expect(await within(upcoming).findByRole("link", { name: /Site visit - Dubai Hills/ })).toHaveAttribute("href", "/workspace/crm/follow-ups?record=a-1");
  expect(within(upcoming).getByText("Next 7 days")).toBeVisible();
  const recent = screen.getByRole("region", { name: "Jump back in" });
  expect(within(recent).getByRole("link", { name: /Villa 12/ })).toHaveAttribute("href", "/workspace/projects/p-1");
  expect(within(recent).getByRole("link", { name: /Amira/ })).toHaveTextContent("Enquiry · Kitchen");
});

it("keeps recent activity for people who read the audit log", async () => {
  api(); const { unmount } = render(<WorkspaceHome {...base} permissions={owner} />);
  expect(await screen.findByRole("region", { name: "Recent activity" })).toHaveTextContent("Villa 12");
  unmount();
  api(); render(<WorkspaceHome {...base} permissions={["projects.view"]} />);
  await screen.findByRole("region", { name: /^Today/ });
  expect(screen.queryByRole("region", { name: "Recent activity" })).not.toBeInTheDocument();
});

it("shows friendly empty states with the next step", async () => {
  api({ home: { ...summary, focus: { items: [], total: 0 }, upcoming: [], recent: [] } }); render(<WorkspaceHome {...base} permissions={["projects.view"]} />);
  const upcoming = await screen.findByRole("region", { name: /^Coming up/ });
  expect(await within(upcoming).findByText("Nothing scheduled")).toBeVisible();
  expect(within(upcoming).getByRole("link", { name: "Open tasks" })).toHaveAttribute("href", "/workspace/tasks");
  expect(within(screen.getByRole("region", { name: "Jump back in" })).getByRole("link", { name: "Open projects" })).toHaveAttribute("href", "/workspace/projects");
});

it("keeps Home usable when a source fails and retries it", async () => {
  const request = api({ home: null }); render(<WorkspaceHome {...base} permissions={owner} />);
  const today = await screen.findByRole("region", { name: /^Today/ });
  expect(await within(today).findByText("Today's work could not be loaded")).toBeVisible();
  // The numbers come from their own source and still show.
  expect(await screen.findByRole("navigation", { name: "Key numbers" })).toBeInTheDocument();
  fireEvent.click(within(today).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(request.mock.calls.filter(([url]) => String(url).includes("home-summary")).length).toBe(2));
});

it("reads Home only from the person's workspace-scoped sources", async () => {
  const request = api(); render(<WorkspaceHome {...base} permissions={owner} />);
  await screen.findByText("Shop drawings");
  const urls = request.mock.calls.map(([url]) => String(url)).sort();
  expect(urls).toEqual([
    // Daily reports to review and sites without today's report (projects are on).
    `/api/site/attention?workspaceId=${base.workspaceId}`,
    `/api/workspace/home-metrics?workspaceId=${base.workspaceId}`,
    `/api/workspace/home-summary?workspaceId=${base.workspaceId}`,
  ]);
});
