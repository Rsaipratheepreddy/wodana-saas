import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ query: "", items: [], searchedKinds: [], truncated: false }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

const workspaces = [
  { description: "Business workspace", id: "wodana", name: "Wodana" },
];
const workspaceModule = workspaceModules.find((module) => module.id === "workspace")!;
const crmModule = workspaceModules.find((module) => module.id === "crm")!;
const preProjectModule = workspaceModules.find((module) => module.id === "pre-project")!;

describe("WorkspaceSidebar", () => {
  it("shows suspended organizations without making them selectable", async () => {
    const interaction = userEvent.setup();
    render(<WorkspaceSidebar activeModule={workspaceModule} modules={workspaceModules} navigation={workspaceModule.navigation}
      pathname="/workspace" workspaces={workspaces}
      unavailableOrganizations={[{ workspaceId: "suspended-1", workspaceName: "Paused Studio", workspaceStatus: "suspended", accountName: "Studio Group" }]} />);
    await interaction.click(screen.getByRole("button", { name: "Switch workspace. Current: Wodana" }));
    const chooser = await screen.findByRole("dialog", { name: "Choose workspace" });
    expect(within(chooser).getByText("Paused Studio")).toBeVisible();
    expect(within(chooser).getByText("Studio Group · Suspended")).toBeVisible();
    expect(within(chooser).queryByRole("button", { name: /Paused Studio/ })).not.toBeInTheDocument();
  });
  it.each(["desktop", "mobile"] as const)("keeps shared destinations accessible on %s", async (mode) => {
    render(<WorkspaceSidebar activeModule={preProjectModule} mode={mode} modules={workspaceModules} navigation={preProjectModule.navigation} pathname="/workspace/pre-projects/requirements" workspaces={workspaces}/>);
    const nav = within(screen.getByRole('navigation',{name:'Main navigation'}));
    for (const name of ['Home','Inbox','Tasks','Calendar','Approvals','Sales','Clients','Projects','Purchasing','Inventory','Factory']) expect(nav.getByRole('link',{name})).toBeVisible();
    expect(nav.queryByRole('link',{name:'Requirements'})).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox',{name:'Search workspace'})).not.toBeInTheDocument();
    expect(nav.getByRole('link',{name:'Tasks'})).toHaveAttribute('href','/workspace/tasks');
    expect(nav.getByRole('link',{name:'Home'})).toBeVisible();
  });

  it("marks Sales as the current workspace without duplicating its tabs", () => {
    render(<WorkspaceSidebar activeModule={crmModule} modules={workspaceModules} navigation={crmModule.navigation} pathname="/workspace/crm/leads" workspaces={workspaces}/>);
    expect(screen.getByRole('link',{name:'Sales'})).toHaveAttribute('aria-current','page');
    expect(screen.queryByRole('link',{name:'Enquiries'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Tasks'})).toBeVisible();
    expect(screen.getByRole('link',{name:'Calendar'})).toBeVisible();
  });

  it("opens the shared approval hub and keeps Sales selected for an unpaid Palm case", () => {
    const {rerender}=render(<WorkspaceSidebar activeModule={crmModule} modules={workspaceModules} navigation={crmModule.navigation} pathname="/workspace/approvals" workspaces={workspaces}/>);
    expect(screen.getByRole('link',{name:'Approvals'})).toHaveAttribute('href','/workspace/approvals');
    expect(screen.getByRole('link',{name:'Approvals'})).toHaveAttribute('aria-current','page');
    rerender(<WorkspaceSidebar activeModule={preProjectModule} activeItemId="sales" modules={workspaceModules} navigation={preProjectModule.navigation} pathname="/workspace/pre-projects/cases/00000000-0000-4000-8000-000000000001/requirements" workspaces={workspaces}/>);
    expect(screen.getByRole('link',{name:'Sales'})).toHaveAttribute('aria-current','page');
    expect(screen.getByRole('link',{name:'Projects'})).not.toHaveAttribute('aria-current');
  });

  it("keeps enquiry setup inside the enquiry workspace instead of the global sidebar", () => {
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm/leads"
        workspaces={workspaces}
      />,
    );

    expect(screen.queryByRole("button", { name: "Toggle Enquiries submenu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Forms" })).not.toBeInTheDocument();
  });

  it("keeps navigation visible without a search row", () => {
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm"
        workspaces={workspaces}
      />,
    );

    expect(screen.queryByRole("searchbox", { name: "Search workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("opens a canonical navigation route", async () => {
    const onNavigate = vi.fn();
    const interaction = userEvent.setup();
    render(<WorkspaceSidebar activeModule={crmModule} modules={workspaceModules} navigation={crmModule.navigation}
      onNavigate={onNavigate} pathname="/workspace/crm" workspaces={workspaces} />);

    const tasks = screen.getByRole("link", { name: "Tasks" });
    expect(tasks).toHaveAttribute("href", "/workspace/tasks");
    await interaction.click(tasks);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("opens the workspace chooser and renders a generated workspace identity", async () => {
    const interaction = userEvent.setup();
    render(
      <WorkspaceSidebar
        activeModule={workspaceModule}
        modules={workspaceModules}
        navigation={workspaceModule.navigation}
        pathname="/workspace"
        workspaces={workspaces}
      />,
    );

    await interaction.click(screen.getByRole("button", { name: /Wodana/ }));
    const dialog = await screen.findByRole("dialog", { name: "Choose workspace" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("W")).toBeVisible();
    await interaction.click(within(dialog).getByRole("button", { name: /Wodana/ }));

    const workspaceMark = document.querySelector<HTMLElement>("[data-workspace-mark]");
    expect(workspaceMark?.style.backgroundImage).toBe("none");
    expect(workspaceMark?.style.backgroundColor).toMatch(/^var\(--wd-identity-color-\d\)$/);
    expect(workspaceMark).toHaveTextContent("W");
  });

  it("groups workspace destinations by the business task they support", () => {
    render(
      <WorkspaceSidebar
        activeModule={workspaceModule}
        modules={workspaceModules}
        navigation={workspaceModule.navigation}
        pathname="/workspace"
        workspaces={workspaces}
      />,
    );

    for (const destination of ['Home','Inbox','Tasks','Calendar','Projects','Purchasing','Inventory','Factory','Connections','Settings']) expect(screen.getByRole('link',{name:destination})).toBeVisible();
    expect(screen.getByRole('link',{name:'Settings'})).toHaveAttribute('href','/workspace/company');
    for (const section of ['Daily work','Business','Operations','Company']) expect(screen.getByRole('button',{name:section})).toBeVisible();
    expect(screen.queryByRole("link", { name: "Manage workspaces" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Teams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "User Settings" })).not.toBeInTheDocument();
  });

});

it("marks the direct Catalog link active without selecting Settings", () => {
  render(<WorkspaceSidebar activeModule={workspaceModules[0]} modules={workspaceModules} navigation={workspaceModules[0].navigation} pathname="/workspace/catalogs" workspaces={workspaces} />);
  const catalog = screen.getByRole("link", { name: "Catalog" });
  expect(screen.getByRole("link", { name: "Connections" })).toBeVisible();
  expect(catalog).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Resources" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
});
