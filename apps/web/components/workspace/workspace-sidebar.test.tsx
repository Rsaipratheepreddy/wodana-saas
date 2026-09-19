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
  it.each(["desktop", "mobile"] as const)("shows requirement sections in the sidebar on %s", async (mode) => {
    const interaction=userEvent.setup();
    const navigation=preProjectModule.navigation.filter(g=>['pre-project-requirements','pre-project-case-sections'].includes(g.id));
    render(<WorkspaceSidebar activeModule={preProjectModule} mode={mode} modules={workspaceModules} navigation={navigation} pathname="/workspace/pre-projects/requirements" workspaces={workspaces}/>);
    const nav=screen.getByRole('navigation',{name:'Main navigation'});
    expect(within(nav).getAllByRole('link').map(l=>l.textContent)).toEqual(['Case overview','Requirements','Client inspirations','Design','Scope confirmation','Quotations','Agreement & payments','Change requests','Approvals & release','Client portal']);
    expect(screen.queryByRole('button',{name:'Commercial & approvals'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Requirements'})).toHaveAttribute('aria-current','page');
    const search=screen.getByRole('searchbox',{name:'Search workspace'});await interaction.type(search,'brief');
    expect(screen.getByRole('link',{name:'Requirements'})).toBeVisible();
    await interaction.keyboard('{Escape}');expect(within(nav).getAllByRole('link')).toHaveLength(10);
  });

  it("shows the CRM operating flow and marks the current destination", () => {
    render(
      <WorkspaceSidebar
        activeModule={crmModule}
        modules={workspaceModules}
        navigation={crmModule.navigation}
        pathname="/workspace/crm/leads"
        workspaces={workspaces}
      />,
    );

    const enquiries = screen.getByRole("link", { name: "Enquiries" });
    expect(enquiries).toHaveAttribute("aria-current", "page");
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["Today", "Jobs", "Enquiries", "Opportunities", "Customers", "Follow-ups", "Calendar", "Inbox", "Smart rules", "Reports"]);
    for (const name of ["Sales flow", "Customer work", "Insights"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Automation" })).not.toBeInTheDocument();
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

    const search = screen.getByRole("searchbox", { name: "Search workspace" });
    await interaction.type(search, "follow");
    expect(screen.getByRole("link", { name: "Follow-ups" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Companies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();

    await interaction.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
  });

  it("shows permitted records with meaningful labels and opens their canonical routes", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "villa",
        searchedKinds: ["customer", "job"],
        truncated: false,
        items: [
          { id: "customer-1", kind: "customer", title: "Amira Hassan", subtitle: "Person · active", reference: null, route: "/workspace/crm/customers?record=customer-1" },
          { id: "job-1", kind: "job", title: "Jumeirah villa", subtitle: "Job · Amira Hassan", reference: "J-000102", route: "/workspace/crm/jobs/job-1" },
        ],
      }),
    } as Response);
    const onNavigate = vi.fn();
    const interaction = userEvent.setup();
    render(<WorkspaceSidebar activeModule={crmModule} modules={workspaceModules} navigation={crmModule.navigation}
      onNavigate={onNavigate} pathname="/workspace/crm" workspaces={workspaces} />);

    await interaction.type(screen.getByRole("searchbox", { name: "Search workspace" }), "villa");
    const results = await screen.findByRole("region", { name: "Workspace search results" });
    const customer = await within(results).findByRole("link", { name: /Amira Hassan.*Customer.*Person · active/ });
    const job = within(results).getByRole("link", { name: /Jumeirah villa.*Job.*J-000102/ });
    expect(customer).toHaveAttribute("href", "/workspace/crm/customers?record=customer-1");
    expect(job).toHaveAttribute("href", "/workspace/crm/jobs/job-1");
    expect(within(results).queryByText("Project")).not.toBeInTheDocument();
    await interaction.click(job);
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

    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
    for (const destination of [
      "Company profile",
      "People",
      "Roles & permissions",
      "Integrations",
      "Client portal",
      "Business records",
      "Sign-in security",
      "Audit history",
      "Billing",
    ]) {
      expect(screen.getByRole("link", { name: destination })).toBeInTheDocument();
    }
    for (const section of ["Company", "Team & access", "Connections", "Account & billing"]) expect(screen.getByRole("button", { name: section })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage workspaces" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Work groups" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "User Settings" })).not.toBeInTheDocument();
  });

});
