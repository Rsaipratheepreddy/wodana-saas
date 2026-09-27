import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceHome } from "./workspace-home";
import { crmScreenFixture } from "@/lib/crm/screens";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/crm/follow-up-editor", () => ({
  FollowUpSheet: ({recordId}: {recordId:string}) => <div>Editing follow-up {recordId}</div>,
  NewFollowUpDialog: () => <div>Create follow-up in place</div>,
}));
vi.mock("./home-attendance", () => ({HomeAttendance: () => <div>Attendance capture</div>}));
afterEach(() => vi.unstubAllGlobals());
const base = { workspaceId: "workspace", userId: "user", workspaceName: "Palm Living", modules: ["crm", "pre-project"], initialData: crmScreenFixture("crm-overview") };
function api(status = 200, showProjects = false, metricsOk = true) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: init?.method === "PUT" ? status === 200 : url.includes("home-metrics") ? metricsOk : true,
    status: init?.method === "PUT" ? status : url.includes("home-metrics") && !metricsOk ? 500 : 200,
    json: async () => url.includes("home-metrics") ? metrics : url.includes("home-overview") ? { sections: {sales:true,planning:true,projects:showProjects}, metrics: {myFollowUps:2,planningCases:1,activeProjects:showProjects?1:null,myProjectTasks:showProjects?1:null}, sales: [], planning: [{id:"case-1",title:"Villa",detail:"Client",date:null,href:"/workspace/pre-projects/cases/case-1/overview"}], projects: [], tasks: [] } : init?.method === "PUT" ? status === 200 ? { widgets: JSON.parse(String(init.body)).widgets, version: 2 } : { message: "Layout changed elsewhere" } : { widgets: [], version: 1 },
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
const metrics = { generatedAt: "2026-09-27T08:00:00Z", timeZone: "UTC", weekStartsOn: 1, currency: "EUR",
  enquiries: { current: 12, previous: 10, weekly: Array.from({ length: 8 }, (_, index) => ({ start: new Date(Date.UTC(2026, 7, 3 + index * 7)).toISOString().slice(0, 10), value: String(index), count: index })) },
  payments: { received: "1500.50", previousReceived: "3001.00", due: "500.00", weekly: Array.from({ length: 8 }, (_, index) => ({ start: new Date(Date.UTC(2026, 7, 3 + index * 7)).toISOString().slice(0, 10), value: "10.00", count: 1 })) },
  storage: { usedBytes: "19000000000", quotaBytes: "80000000000", areas: { projects: "9000000000", planning: "5000000000", catalog: "3000000000", other: "2000000000" } } };
it("shows only permitted KPI cards with change words and tones", async () => {
  api(); render(<WorkspaceHome {...base} firstName="Sara" permissions={["crm.leads.view", "receivables.view"]} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Sara/);
  const enquiries = (await screen.findByText("New enquiries")).closest("a");
  expect(enquiries).toHaveAttribute("href", "/workspace/crm/leads");
  expect(enquiries).toHaveTextContent("12");
  expect(enquiries).toHaveTextContent("Up 20% on last month");
  expect(screen.getByText("Payments received").closest("a")).toHaveTextContent("Down 50% on last month");
  expect(screen.getByText("Payments received").closest("a")).toHaveTextContent("€");
  expect(screen.queryByText("Active projects")).not.toBeInTheDocument();
  expect(screen.queryByText("Quotes issued")).not.toBeInTheDocument();
});
it("keeps Home usable when figures fail and retries them", async () => {
  const request = api(200, false, false); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  expect(await screen.findByText("Figures could not be loaded")).toBeVisible();
  expect(screen.getByRole("region", { name: "Needs attention" })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  await waitFor(() => expect(request.mock.calls.filter(([url]) => String(url).includes("home-metrics")).length).toBe(2));
});
it("shows storage used against the allowance by area", async () => {
  api(); render(<WorkspaceHome {...base} canManage />);
  const storage = await screen.findByRole("region", { name: "Storage overview" });
  await waitFor(() => expect(storage).toHaveTextContent("19 GB of 80 GB"));
  expect(storage).toHaveTextContent("24% of your allowance");
  expect(storage).toHaveTextContent("Catalog");
});
it("filters panels using Home tabs", async () => {
  api(); render(<WorkspaceHome {...base} permissions={["pre_projects.view", "crm.leads.view"]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Planning" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "In planning" })).toHaveTextContent("Villa"));
  expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getByRole("region", { name: "Needs attention" })).toBeInTheDocument();
});
it("edits Home in place: remove, resize, move with the keyboard, add from the gallery, and save with the version", async () => {
  const request = api(); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Home" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove Quick actions" }));
  expect(screen.queryByRole("region", { name: "Quick actions" })).not.toBeInTheDocument();
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
});
it("keeps the edit draft and asks for a reload after a conflict", async () => {
  api(409); render(<WorkspaceHome {...base} permissions={["crm.leads.view"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Home" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove Quick actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Layout changed elsewhere");
  expect(screen.queryByRole("region", { name: "Quick actions" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
});
it("keeps restricted summaries hidden", async () => {
  api(); const { rerender } = render(<WorkspaceHome {...base} initialData={{ ...base.initialData, canView: false }} />);
  expect(screen.queryByRole("region", { name: "Needs attention" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Plan follow-up" })).not.toBeInTheDocument();
  rerender(<WorkspaceHome {...base} userId="other-user" initialData={null} />);
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("could not be loaded");
  expect(screen.queryByText("No work needs attention")).not.toBeInTheDocument();
});
it("shows workspace setup on Home for managers and opens the existing checklist", () => {
  api();
  const { rerender } = render(<WorkspaceHome {...base} canManage readiness={{ company: true, regional: true, people: false, connections: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up your workspace, 2 of 6 complete" }));
  expect(screen.getByRole("dialog", { name: "Set up your workspace" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Manage people/ })).toBeVisible();
  rerender(<WorkspaceHome {...base} canManage={false} />);
  expect(screen.queryByRole("button", { name: /Set up your workspace/ })).not.toBeInTheDocument();
});
