import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { WorkspaceShell } from "./workspace-shell";
import { renderToString } from "react-dom/server";
import { CrmProductShell } from "../crm/crm-product-shell";
import { ProjectRevampTabs } from "../projects/project-revamp-tabs";

const route = vi.hoisted(() => ({ pathname: "/workspace/members", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.search),
}));

const shellProps = {
  modules: workspaceModules,
  user: { email: "admin@example.com", name: "Workspace owner" },
  workspaces: [{ description: "Business workspace", id: "workspace-1", name: "Example Studio" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  route.pathname = "/workspace/members";
  route.search = "";
  window.localStorage.clear();
  document.documentElement.dataset.theme = "light";
});

describe("WorkspaceShell theme", () => {
  it("resolves a directly opened project breadcrumb without relying on the page registration", async () => {
    route.pathname = "/workspace/projects/new/12345678-1234-1234-1234-123456789abc";
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes("/execution?")
      ? {ok:true,json:async()=>({name:"Palm Living Demo · Jumeirah Garden Villa"})}
      : {ok:true,json:async()=>({items:[]})});
    vi.stubGlobal("fetch",fetcher);
    render(<WorkspaceShell {...shellProps}><p>Project tabs</p></WorkspaceShell>);
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(await breadcrumb.findByRole("link", { name:"Jumeirah Garden Villa" })).toHaveAttribute("aria-current","page");
    expect(breadcrumb.queryByText("Loading project…")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith("/api/projects/12345678-1234-1234-1234-123456789abc/execution?workspaceId=workspace-1",expect.objectContaining({signal:expect.any(AbortSignal)}));
  });
  it("shows the passed project name before the project page has loaded", () => {
    route.pathname = "/workspace/projects/new/12345678-1234-1234-1234-123456789abc";
    route.search = "projectName=Jumeirah+Garden+Villa";
    render(<WorkspaceShell {...shellProps}><p>Loading content</p></WorkspaceShell>);
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getByRole("link", { name: "Jumeirah Garden Villa" })).toBeVisible();
    expect(breadcrumb.queryByText("Loading project…")).not.toBeInTheDocument();
  });
  it("shows the actual project name as a breadcrumb link and clears it when leaving the project", () => {
    route.pathname = "/workspace/projects/new/12345678-1234-1234-1234-123456789abc";
    const view = render(<WorkspaceShell {...shellProps}><ProjectRevampTabs projectName="Jumeirah Garden Villa"/></WorkspaceShell>);
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/workspace/projects");
    expect(breadcrumb.getByRole("link", { name: "Jumeirah Garden Villa" })).toHaveAttribute("href", `${route.pathname}?projectName=Jumeirah+Garden+Villa`);
    expect(breadcrumb.getByRole("link", { name: "Jumeirah Garden Villa" })).toHaveAttribute("aria-current", "page");
    expect(breadcrumb.queryByText("Loading project…")).not.toBeInTheDocument();
    route.pathname = "/workspace/projects";
    view.rerender(<WorkspaceShell {...shellProps}><p>Project list</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).not.toHaveTextContent("Jumeirah Garden Villa");
  });
  it("keeps the main workspace navigation visible inside CRM", () => {
    route.pathname = "/workspace/crm/leads";
    render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Enquiries");
  });
  it("collapses and reopens the Business group with pointer and keyboard", async () => {
    route.pathname = "/workspace/projects";
    const user = userEvent.setup();
    render(<WorkspaceShell {...shellProps}><p>Content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    const trigger = navigation.getByRole("button", { name: "Business" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(navigation.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(navigation.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/workspace/projects");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
  it("shows only authorized products on Home", () => {
    route.pathname = "/workspace";
    render(<WorkspaceShell {...shellProps} modules={workspaceModules.filter((module) => !["pre-project", "projects"].includes(module.id))}><p>Home content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/workspace/crm");
    expect(navigation.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("gives Planning its own sidebar entry, separate from Projects, with Catalog directly in the sidebar", () => {
    route.pathname = '/workspace/pre-projects';
    render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    expect(screen.queryByRole('navigation',{name:'Workspace sections'})).not.toBeInTheDocument();
    const sidebar = within(screen.getByRole('navigation',{name:'Main navigation'}));
    expect(sidebar.getByRole('link',{name:'Planning'})).toHaveAttribute('aria-current','page');
    expect(sidebar.getByRole('link',{name:'Projects'})).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link',{name:'Catalog'})).toHaveAttribute('href','/workspace/catalogs');
    expect(screen.queryByRole('button',{name:'Resources'})).not.toBeInTheDocument();
  });

  it("keeps a focused portfolio sidebar on the projects landing page", () => {
    route.pathname = "/workspace/projects";
    const { container } = render(<WorkspaceShell {...shellProps}><p>Project portfolio</p></WorkspaceShell>);
    expect(container.querySelector("[data-module-selector]")).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(expect.arrayContaining(["Projects", "Sales", "Calendar", "Tasks"]));
    expect(navigation.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("opens planning tabs while keeping Catalog as a direct sidebar destination", () => {
    route.pathname = "/workspace/pre-projects";
    const view = render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    const casePath = "/workspace/pre-projects/cases/e56299c6-3da3-402a-a9ac-3995bb37b9d4";
    route.pathname = `${casePath}/requirements`;
    view.rerender(<WorkspaceShell {...shellProps}><p>Case content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Planning sections" }));
    expect(navigation.getByRole("link", { name: "Requirements" })).toHaveAttribute("href", `${casePath}/requirements`);
    expect(navigation.getByRole("link", { name: "Requirements" })).toHaveAttribute("aria-current", "page");
    expect(navigation.getAllByRole("link").map(link => link.textContent)).toEqual(["Overview", "Requirements", "Site", "Moodboard", "Design", "Quotes", "Agreement"]);
    expect(navigation.getByRole("link", { name: "Site" })).toHaveAttribute("href", `${casePath}/site`);
    expect(navigation.getByRole("link", { name: "Moodboard" })).toHaveAttribute("href", `${casePath}/inspiration`);
    expect(screen.queryByRole("navigation", { name: "Requirements views" })).not.toBeInTheDocument();
    expect(navigation.queryByRole("link", { name: "Catalog" })).not.toBeInTheDocument();
    const sidebar = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(sidebar.getByRole("link", { name: "Planning" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/workspace/catalogs");
    expect(sidebar.queryByRole("button", { name: "Resources" })).not.toBeInTheDocument();
    route.pathname = "/workspace/catalogs";
    view.rerender(<WorkspaceShell {...shellProps}><p>Catalog content</p></WorkspaceShell>);
    expect(screen.queryByRole("navigation", { name: "Planning sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Requirements" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Catalog" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps Client Inbox standalone with direct Tasks and Calendar links", () => {
    route.pathname = "/workspace/crm/conversations";
    const content = <WorkspaceShell {...shellProps}><CrmProductShell title="Inbox" description="Chats" canView compact><p>Chat content</p></CrmProductShell></WorkspaceShell>;
    expect(renderToString(content)).not.toContain('data-focus="true"');
    const { container } = render(content);
    expect(container.querySelector('[data-focus="true"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to CRM" })).not.toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "Workspace sections" })).not.toBeInTheDocument();
    expect(navigation.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/workspace/tasks");
    expect(navigation.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/workspace/crm/follow-ups?view=schedule");
    expect(navigation.getByRole("link", { name: "Factory" })).toHaveAttribute("href", "/workspace/projects/factory");
    expect(navigation.queryByRole("button", { name: "Production Tracking" })).not.toBeInTheDocument();
  });
  it("keeps the sidebar and a single Calendar breadcrumb on the schedule route", () => {
    route.pathname = "/workspace/crm/follow-ups";
    route.search = "view=schedule";
    const { container } = render(<WorkspaceShell {...shellProps}><p>Calendar content</p></WorkspaceShell>);
    expect(container.querySelector('[data-focus="true"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to CRM" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Calendar")).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  });
  it("shows global Operations destinations without a misleading Projects breadcrumb", () => {
    route.pathname = "/workspace/projects/inventory";
    render(<WorkspaceShell {...shellProps}><p>Inventory content</p></WorkspaceShell>);
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getByText("Inventory")).toBeVisible();
    expect(breadcrumb.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
  });
  it("toggles light and dark mode from the header and persists the choice", async () => {
    const interaction = userEvent.setup();
    render(<WorkspaceShell {...shellProps}><p>Workspace content</p></WorkspaceShell>);

    await interaction.click(screen.getByRole("button", { name: "Use dark mode" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("wodana-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light mode" })).toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Use light mode" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
    expect(window.localStorage.getItem("wodana-theme")).toBe("light");
  });

  it("shows the signed-in account as the final header avatar", async () => {
    const interaction = userEvent.setup();
    render(<WorkspaceShell {...shellProps}><p>Workspace content</p></WorkspaceShell>);

    const accountButton = screen.getByRole("button", { name: "Account menu for Workspace owner" });
    expect(accountButton.closest("header")).not.toBeNull();
    await interaction.click(accountButton);

    const accountMenu = await screen.findByRole("dialog", { name: "Account menu" });
    expect(within(accountMenu).getByText("Workspace owner")).toBeVisible();
    expect(within(accountMenu).getByText("admin@example.com")).toBeVisible();
    expect(within(accountMenu).getByRole("link", { name: "Sign-in security" })).toHaveAttribute("href", "/workspace/settings/security");
    expect(within(accountMenu).getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("opens and closes the Woddy chat panel from the header", async () => {
    const interaction = userEvent.setup();
    render(<WorkspaceShell {...shellProps}><p>Workspace content</p></WorkspaceShell>);

    await interaction.click(screen.getByRole("button", { name: "Ask Woddy" }));
    expect(screen.getByRole("dialog", { name: "Woddy chat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Woddy" })).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Close Woddy chat" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Woddy chat" })).not.toBeInTheDocument());
  });
});
