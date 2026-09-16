import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const workspaces = [
  { description: "Business workspace", id: "wodana", name: "Wodana" },
];
const workspaceModule = workspaceModules.find((module) => module.id === "workspace")!;
const crmModule = workspaceModules.find((module) => module.id === "crm")!;
const preProjectModule = workspaceModules.find((module) => module.id === "pre-project")!;

describe("WorkspaceSidebar", () => {
  it.each(["desktop", "mobile"] as const)("shows requirement sections in the sidebar on %s", async (mode) => {
    const interaction=userEvent.setup();
    const navigation=preProjectModule.navigation.filter(g=>['pre-project-requirements','pre-project-case-sections'].includes(g.id));
    render(<WorkspaceSidebar activeModule={preProjectModule} mode={mode} modules={workspaceModules} navigation={navigation} pathname="/workspace/pre-projects/requirements" workspaces={workspaces}/>);
    const nav=screen.getByRole('navigation',{name:'Main navigation'});
    expect(within(nav).getAllByRole('link').map(l=>l.textContent)).toEqual(['Requirements','Client inspirations','Design','Quotations','Agreement & payments','Change requests','Approvals & release','Client portal']);
    expect(screen.queryByRole('button',{name:'Commercial & approvals'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Requirements'})).toHaveAttribute('aria-current','page');
    const search=screen.getByRole('searchbox',{name:'Search navigation'});await interaction.type(search,'brief');
    expect(screen.getByRole('link',{name:'Requirements'})).toBeVisible();
    await interaction.keyboard('{Escape}');expect(within(nav).getAllByRole('link')).toHaveLength(8);
  });

  it("shows the simplified CRM navigation and marks the current destination", () => {
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm/leads"
        workspaces={workspaces}
      />,
    );

    const leads = screen.getByRole("link", { name: "Leads" });
    expect(leads).toHaveAttribute("aria-current", "page");
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["Overview", "Leads", "Follow-ups", "Calendar", "Inbox"]);
    for (const name of ["Customers & sales", "Automation", "Insights"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("filters destinations and clears search with Escape", async () => {
    const interaction = userEvent.setup();
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm"
        workspaces={workspaces}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search navigation" });
    await interaction.type(search, "follow");
    expect(screen.getByRole("link", { name: "Follow-ups" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Organizations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();

    await interaction.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
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
    expect(workspaceMark?.style.backgroundImage).toMatch(/^var\(--wd-identity-gradient-\d\)$/);
    expect(workspaceMark).toHaveTextContent("W");
  });

  it("shows only the required workspace administration sections", () => {
    render(
      <WorkspaceSidebar
        activeModule={workspaceModule}
        modules={workspaceModules}
        navigation={workspaceModule.navigation}
        pathname="/workspace"
        workspaces={workspaces}
      />,
    );

    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
    for (const destination of [
      "Org profile",
      "Members",
      "Teams and business units",
      "Roles and permissions",
      "Integrations",
      "Billing",
      "User Settings",
    ]) {
      expect(screen.getByRole("link", { name: destination })).toBeInTheDocument();
    }
  });

  it("opens the module switcher with deep-linkable products", async () => {
    const interaction = userEvent.setup();
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm"
        workspaces={workspaces}
      />,
    );

    await interaction.click(screen.getByRole("button", { name: "Switch module. Current: CRM" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose module" });
    expect(within(dialog).getByRole("link", { name: /CRM/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(dialog).getByRole("link", { name: /Pre-execution/ })).toHaveAttribute(
      "href",
      "/workspace/pre-projects",
    );
    expect(within(dialog).getByRole("link", { name: /Projects/ })).toHaveAttribute(
      "href",
      "/workspace/projects",
    );
    expect(within(dialog).getByRole("link", { name: /HRMS/ })).toHaveAttribute(
      "href",
      "/workspace/hrms",
    );
    expect(within(dialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/workspace",
      "/workspace/crm",
      "/workspace/pre-projects",
      "/workspace/projects",
      "/workspace/hrms",
    ]);
    expect(Array.from(dialog.querySelectorAll("[data-module]")).map((icon) => icon.getAttribute("data-module"))).toEqual([
      "workspace", "crm", "pre-project", "projects", "hrms",
    ]);
  });
});
