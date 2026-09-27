import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceHome } from "./workspace-home";
import { crmScreenFixture } from "@/lib/crm/screens";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/crm/follow-up-editor", () => ({
  FollowUpSheet: ({recordId}: {recordId:string}) => <div>Editing follow-up {recordId}</div>,
  NewFollowUpDialog: () => <div>Create follow-up in place</div>,
}));
vi.mock("./home-attendance", () => ({HomeAttendance: () => <span>Attendance chip</span>}));
afterEach(() => vi.unstubAllGlobals());
const base = { workspaceId: "workspace", userId: "user", workspaceName: "Palm Living", modules: ["crm", "pre-project"], initialData: crmScreenFixture("crm-overview") };
const weeks = (value: (index: number) => string) => Array.from({ length: 8 }, (_, index) => ({ start: new Date(Date.UTC(2026, 7, 3 + index * 7)).toISOString().slice(0, 10), value: value(index), count: index }));
const metrics = { generatedAt: "2026-09-27T08:00:00Z", timeZone: "UTC", weekStartsOn: 1, currency: "EUR",
  enquiries: { current: 12, previous: 10, weekly: weeks(index => String(index)) },
  payments: { received: "1500.50", previousReceived: "3001.00", due: "500.00", weekly: weeks(() => "10.00") },
  storage: { usedBytes: "19000000000", quotaBytes: "80000000000", areas: { projects: "9000000000", planning: "5000000000", catalog: "3000000000", other: "2000000000" } } };
const busy = { ...metrics,
  followUps: { open: 5, overdue: 2 },
  quotes: { issuedValue: "900.00", previousIssuedValue: "0.00", issuedCount: 1, accepted: 0, previousAccepted: 0, awaiting: 3, weekly: weeks(() => "0.00") },
  projects: { active: 4, overdueTasks: 3, onTrack: 2, atRisk: 1, late: 1, weekly: weeks(() => "0") },
  orders: { toReceive: 0 } };
function api({ status = 200, showProjects = false, metricsOk = true, figures = metrics as object, layout = [] as object[] } = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: init?.method === "PUT" ? status === 200 : url.includes("home-metrics") ? metricsOk : true,
    status: init?.method === "PUT" ? status : url.includes("home-metrics") && !metricsOk ? 500 : 200,
    json: async () => url.includes("home-metrics") ? figures : url.includes("home-overview") ? { sections: {sales:true,planning:true,projects:showProjects}, metrics: {myFollowUps:2,planningCases:1,activeProjects:showProjects?1:null,myProjectTasks:showProjects?1:null}, sales: [], planning: [{id:"case-1",title:"Villa",detail:"Client",date:null,href:"/workspace/pre-projects/cases/case-1/overview"}], projects: [], tasks: [] } : init?.method === "PUT" ? status === 200 ? { widgets: JSON.parse(String(init.body)).widgets, version: 2 } : { message: "Layout changed elsewhere" } : { widgets: layout, version: 1 },
  }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("opens a linked follow-up in place and provides one catalog destination", async () => {
  api(); const initialData = crmScreenFixture("crm-overview");
  initialData.items[0].deepLink = "/crm/activities/74000000-0000-4000-8000-000000000001";
  render(<WorkspaceHome {...base} initialData={initialData}/>);
  fireEvent.click(screen.getByRole("button", {name:"Update follow-up"}));
  expect(screen.getByText(/Editing follow-up 74000000/)).toBeVisible();
  expect(screen.getByRole("link", {name:/^Catalog/})).toHaveAttribute("href", "/workspace/catalogs");
  expect(screen.queryByRole("link", {name:/^Materials/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"Plan follow-up"}));
  expect(screen.getByText("Create follow-up in place")).toBeVisible();
});

it("keeps the page anatomy: one title, one primary action, and the product-tour anchors", () => {
  api(); render(<WorkspaceHome {...base} firstName="Sara" permissions={["crm.leads.view"]} />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "New enquiry" })).toHaveAttribute("data-variant", "primary");
  expect(screen.getByRole("button", { name: "Edit Home" })).toHaveAttribute("data-tour", "home-edit");
  expect(screen.getByRole("region", { name: "Needs attention" })).toHaveAttribute("data-tour", "home-widget-attention");
});

it("filters the work that needs attention with counts on each list", () => {
  api(); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  const attention = screen.getByRole("region", { name: "Needs attention" });
  const filters = within(attention).getByRole("group", { name: "Filter work" });
  expect(within(filters).getByRole("button", { name: /^All work/ })).toHaveTextContent("All work2");
  expect(within(filters).getByRole("button", { name: /^All work/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(filters).getByRole("button", { name: /^Client replies/ }));
  expect(within(attention).getByText("Customer reply requires action", { exact: false })).toBeInTheDocument();
  expect(within(attention).queryByText("Review Dubai wellness clinic brief")).not.toBeInTheDocument();
});

it("sums up in one strip the figures the person can act on, each linking to its list, toned only when something needs attention", async () => {
  api({ figures: busy }); render(<WorkspaceHome {...base} firstName="Sara" permissions={["crm.leads.view", "crm.activities.view", "receivables.view"]} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Sara/);
  const summary = await screen.findByRole("navigation", { name: "Summary" });
  const figures = within(summary).getAllByRole("link");
  expect(figures.map(link => link.getAttribute("href"))).toEqual(["/workspace/crm/follow-ups", "/workspace/pre-projects?section=quotations", "/workspace/projects", "/workspace/purchasing/orders"]);
  expect(figures[0]).toHaveTextContent("5Follow-ups to do2 overdue");
  expect(within(figures[0]).getByText("2 overdue")).toHaveAttribute("data-tone", "warning");
  expect(figures[1]).toHaveTextContent("3Quotes awaiting the client");
  expect(within(figures[2]).getByText("1 late")).toHaveAttribute("data-tone", "danger");
  expect(figures[3]).toHaveTextContent("0Orders to receive");
  expect(figures[3].querySelector("[data-tone]")).toBeNull();
  // At most four figures: money due and new enquiries wait for room.
  expect(within(summary).queryByText("Due this month")).not.toBeInTheDocument();
});

it("falls back to money due and new enquiries when those are what the person may see", async () => {
  api(); render(<WorkspaceHome {...base} permissions={["crm.leads.view", "receivables.view"]} />);
  const summary = await screen.findByRole("navigation", { name: "Summary" });
  expect(within(summary).getByRole("link", { name: /Due this month/ })).toHaveTextContent("€");
  expect(within(summary).getByRole("link", { name: /New enquiries this month/ })).toHaveAttribute("href", "/workspace/crm/leads");
  expect(within(summary).getByRole("link", { name: /New enquiries this month/ })).toHaveTextContent("12");
  expect(within(summary).queryByText("Active projects")).not.toBeInTheDocument();
});

it("keeps Home usable when figures fail and retries them", async () => {
  const request = api({ metricsOk: false }); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  expect(await screen.findByText("Figures could not be loaded")).toBeVisible();
  expect(screen.getByRole("region", { name: "Needs attention" })).toBeInTheDocument();
  // The chart shows the standard error state with its own retry.
  expect(within(screen.getByRole("region", { name: "Sales trend" })).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  await waitFor(() => expect(request.mock.calls.filter(([url]) => String(url).includes("home-metrics")).length).toBe(2));
});

it("shows storage used against the allowance by area when it is on the saved Home", async () => {
  api({ layout: [{ id: "storage", visible: true, size: "small" }] }); render(<WorkspaceHome {...base} canManage />);
  const storage = await screen.findByRole("region", { name: "Storage overview" });
  await waitFor(() => expect(storage).toHaveTextContent("19 GB of 80 GB"));
  expect(storage).toHaveTextContent("24% of your allowance");
  expect(storage).toHaveTextContent("Catalog");
});

it("starts compact: at most two rows of widgets for a manager", async () => {
  api({ showProjects: true, figures: busy }); render(<WorkspaceHome {...base} modules={["crm", "pre-project", "projects"]} canManage />);
  await waitFor(() => expect(screen.getByRole("region", { name: "My tasks" })).toBeInTheDocument());
  const regions = screen.getAllByRole("region").map(region => region.getAttribute("aria-label")).filter(name => name !== "Workspace Home");
  expect(regions).toEqual(["Needs attention", "My tasks", "Sales trend", "Money in", "Projects health"]);
});

it("shows today's attendance as a chip in the header, not a widget", () => {
  api(); render(<WorkspaceHome {...base} modules={["crm", "hrms"]} permissions={["crm.leads.view"]} />);
  expect(screen.getByText("Attendance chip").closest("header")).toHaveClass("wd-page-header");
  expect(screen.queryByRole("region", { name: "Attendance" })).not.toBeInTheDocument();
});

it("shows every section on one page, without a tab bar", async () => {
  api(); render(<WorkspaceHome {...base} permissions={["pre_projects.view", "crm.leads.view"]} />);
  await waitFor(() => expect(screen.getByRole("region", { name: "In planning" })).toHaveTextContent("Villa"));
  expect(screen.getByRole("region", { name: "Needs attention" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Home sections" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Planning" })).not.toBeInTheDocument();
});

it("edits Home in place: remove, resize, move with the keyboard, add from the gallery, and save with the version", async () => {
  const request = api(); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Home" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove In planning" }));
  expect(screen.queryByRole("region", { name: "In planning" })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("group", { name: "Size of Needs attention" })).getByRole("button", { name: "Wide" }));
  const regions = () => screen.getAllByRole("region").map(region => region.getAttribute("aria-label")).filter(name => name !== "Workspace Home");
  const before = regions();
  fireEvent.keyDown(screen.getByRole("button", { name: `Move ${before[1]}` }), { key: "ArrowUp" });
  expect(regions().slice(0, 2)).toEqual([before[1], before[0]]);
  fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add Quick actions" }));
  expect(screen.getByRole("region", { name: "Quick actions" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument());
  const write = request.mock.calls.find(([, init]) => init?.method === "PUT");
  const body = JSON.parse(String(write?.[1]?.body));
  expect(body).toMatchObject({ workspaceId: "workspace", version: 1 });
  expect(body.widgets.find((item: { id: string }) => item.id === "attention")).toMatchObject({ size: "wide", wide: true });
  expect(body.widgets.some((item: { id: string }) => item.id === "attendance")).toBe(false);
});

it("keeps the edit draft and asks for a reload after a conflict", async () => {
  api({ status: 409 }); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Home" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove In planning" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Layout changed elsewhere");
  expect(screen.queryByRole("region", { name: "In planning" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
});

it("keeps restricted summaries hidden", async () => {
  api(); const { rerender } = render(<WorkspaceHome {...base} initialData={{ ...base.initialData, canView: false }} />);
  expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Plan follow-up" })).not.toBeInTheDocument();
  rerender(<WorkspaceHome {...base} userId="other-user" initialData={null} />);
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("could not be loaded");
  expect(within(screen.getAllByRole("alert")[0]).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByText("No work needs attention")).not.toBeInTheDocument();
});

it("keeps workspace setup off Home; it lives in the account menu", () => {
  api(); render(<WorkspaceHome {...base} canManage />);
  expect(screen.queryByText(/Set up your workspace/)).not.toBeInTheDocument();
});
