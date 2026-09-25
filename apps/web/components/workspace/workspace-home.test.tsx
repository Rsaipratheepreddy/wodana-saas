import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceHome } from "./workspace-home";
import { crmScreenFixture } from "@/lib/crm/screens";
import { defaultHomeLayout } from "@/lib/workspace/home-layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/crm/follow-up-editor", () => ({
  FollowUpSheet: ({recordId}: {recordId:string}) => <div>Editing follow-up {recordId}</div>,
  NewFollowUpDialog: () => <div>Create follow-up in place</div>,
}));
vi.mock("./home-attendance", () => ({HomeAttendance: () => <div>Attendance capture</div>}));
afterEach(() => vi.unstubAllGlobals());
const base = { workspaceId: "workspace", userId: "user", workspaceName: "Palm Living", modules: ["crm", "pre-project"], initialData: crmScreenFixture("crm-overview") };
function api(status = 200, showProjects = false) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: init?.method === "PUT" ? status === 200 : true,
    status: init?.method === "PUT" ? status : 200,
    json: async () => url.includes("home-overview") ? { sections: {sales:true,planning:true,projects:showProjects}, metrics: {myFollowUps:2,planningCases:1,activeProjects:showProjects?1:null,myProjectTasks:showProjects?1:null}, sales: [], planning: [{id:"case-1",title:"Villa",detail:"Client",date:null,href:"/workspace/pre-projects/cases/case-1/overview"}], projects: [], tasks: [] } : init?.method === "PUT" ? status === 200 ? { widgets: JSON.parse(String(init.body)).widgets, version: 2 } : { message: "Layout changed elsewhere" } : { widgets: defaultHomeLayout, version: 1 },
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
it("shows live cross-module counts and filters panels using Home tabs", async () => {
  api(); render(<WorkspaceHome {...base} />);
  expect((await screen.findByText("My follow-ups")).closest("a")).toHaveAttribute("href", "/workspace/crm/follow-ups");
  expect(screen.getByText("My follow-ups").closest("a")).toHaveTextContent("2");
  fireEvent.click(screen.getByRole("button", { name: "Planning" }));
  expect(screen.getByRole("region", { name: "In planning" })).toHaveTextContent("Villa");
  expect(screen.queryByRole("region", { name: "Sales snapshot" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getByRole("region", { name: "Sales snapshot" })).toBeInTheDocument();
});
it("opens the project task board from the My project tasks summary", async () => {
  api(200, true);
  render(<WorkspaceHome {...base} modules={[...base.modules, "projects"]} />);
  expect((await screen.findByText("My project tasks")).closest("a")).toHaveAttribute("href", "/workspace/tasks");
  expect(screen.getByText("My project tasks").closest("a")).toHaveTextContent("1");
});
it("saves layout through the server with version protection", async () => {
  const request = api(); render(<WorkspaceHome {...base}/>);
  fireEvent.click(screen.getByRole("button", {name:"Customize Home"}));
  await waitFor(() => expect(screen.getByRole("button", {name:"Save layout"})).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox", {name:"Sales snapshot"}));
  fireEvent.click(screen.getByRole("button", {name:"Save layout"}));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("region", {name:"Sales snapshot"})).not.toBeInTheDocument();
  const write = request.mock.calls.find(([,init]) => init?.method === "PUT");
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({ workspaceId:"workspace", version:1 });
});
it("retains the customization draft and requires reload after a conflict", async () => {
  api(409); render(<WorkspaceHome {...base}/>);
  fireEvent.click(screen.getByRole("button", {name:"Customize Home"}));
  await waitFor(() => expect(screen.getByRole("button", {name:"Save layout"})).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox", {name:"Sales snapshot"}));
  fireEvent.click(screen.getByRole("button", {name:"Save layout"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Layout changed elsewhere");
  expect(screen.getByRole("checkbox", {name:"Sales snapshot"})).not.toBeChecked();
  expect(screen.getByRole("button", {name:"Save layout"})).toBeDisabled();
});
it("keeps restricted summaries hidden and unavailable counts unknown", async () => {
  api(); const {rerender} = render(<WorkspaceHome {...base} initialData={{...base.initialData,canView:false}}/>);
  expect(screen.queryByRole("region", {name:"Needs attention"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name:"Plan follow-up"})).not.toBeInTheDocument();
  rerender(<WorkspaceHome {...base} userId="other-user" initialData={null}/>);
  expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
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
