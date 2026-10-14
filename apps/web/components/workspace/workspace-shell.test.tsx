import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { useWorkspaceBreadcrumb } from "./workspace-breadcrumb";
import { WorkspaceShell } from "./workspace-shell";
import { renderToString } from "react-dom/server";
import { CrmProductShell } from "../crm/crm-product-shell";
import { PageShell, SettingsPage } from "@/design-system";

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
  it("names a project page in the breadcrumb once the page registers it, and clears it when leaving", () => {
    route.pathname = "/workspace/projects/12345678-1234-4234-8234-123456789abc";
    function Page() { useWorkspaceBreadcrumb("Jumeirah Garden Villa"); return <p>Project</p>; }
    const view = render(<WorkspaceShell {...shellProps}><Page /></WorkspaceShell>);
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/workspace/projects");
    expect(breadcrumb.getByText("Jumeirah Garden Villa")).toBeVisible();
    route.pathname = "/workspace/projects";
    view.rerender(<WorkspaceShell {...shellProps}><p>Project list</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).not.toHaveTextContent("Jumeirah Garden Villa");
  });
  it("ends the breadcrumb at Projects when the project names itself in its header", () => {
    route.pathname = "/workspace/projects/12345678-1234-4234-8234-123456789abc";
    function Page() { useWorkspaceBreadcrumb("Jumeirah Garden Villa", { ownTitle: true }); return <h1>Jumeirah Garden Villa</h1>; }
    render(<WorkspaceShell {...shellProps}><Page /></WorkspaceShell>);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(breadcrumb).not.toHaveTextContent("Jumeirah Garden Villa");
    expect(screen.getAllByText("Jumeirah Garden Villa")).toHaveLength(1);
  });
  it("names each page once: the top bar or the module's tabs name it, the page keeps its title for screen readers", () => {
    route.pathname = "/workspace/crm/opportunities";
    const view = render(<WorkspaceShell {...shellProps}><PageShell title="Pipeline" action={<button type="button">Convert enquiry</button>}>Board</PageShell></WorkspaceShell>);
    expect(within(screen.getByRole("navigation", { name: "Sales sections" })).getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toHaveClass("wd-visually-hidden");
    // A page the chrome doesn't name keeps its visible title.
    route.pathname = "/workspace/crm/follow-ups";
    view.rerender(<WorkspaceShell {...shellProps}><PageShell title="Something else">List</PageShell></WorkspaceShell>);
    expect(screen.getByRole("heading", { level: 1, name: "Something else" })).not.toHaveClass("wd-visually-hidden");
    // Calendar is named by the breadcrumb.
    route.pathname = "/workspace/crm/follow-ups";
    route.search = "view=schedule";
    view.rerender(<WorkspaceShell {...shellProps}><PageShell title="Calendar">Grid</PageShell></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Calendar$/);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toHaveClass("wd-visually-hidden");
  });
  it("ends the breadcrumb at People and Settings on their tabs, and the open tab names the page", () => {
    route.pathname = "/workspace/teams";
    const view = render(<WorkspaceShell {...shellProps}><SettingsPage title="Teams">Teams</SettingsPage></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^People$/);
    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toHaveClass("wd-visually-hidden");
    route.pathname = "/workspace/settings/profile";
    view.rerender(<WorkspaceShell {...shellProps}><SettingsPage title="Profile">Profile</SettingsPage></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Settings$/);
    expect(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toHaveClass("wd-visually-hidden");
  });
  it("ends the breadcrumb at Sales on a Sales tab, so Enquiries is named by its tab and title only", () => {
    route.pathname = "/workspace/crm/leads";
    render(<WorkspaceShell {...shellProps}><p>Enquiries</p></WorkspaceShell>);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent(/^Sales$/);
    expect(within(breadcrumb).queryByRole("link")).toBeNull();
  });
  it("gives the steps builder the whole screen: no sidebar and no top bar; the enquiry types list keeps them", () => {
    route.pathname = "/workspace/enquiry-types/12345678-1234-4234-8234-123456789abc";
    const view = render(<WorkspaceShell {...shellProps}><p>Builder</p></WorkspaceShell>);
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    route.pathname = "/workspace/enquiry-types";
    view.rerender(<WorkspaceShell {...shellProps}><p>Enquiry types list</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });
  it("follows the firm's colour on staff screens but keeps titles in sentence case (no all-caps brand typeface)", () => {
    route.pathname = "/workspace/crm/leads";
    const { container } = render(<WorkspaceShell {...shellProps} workspaces={[{ ...shellProps.workspaces[0], primaryColor: "#0F766E", headingFont: "alta", bodyFont: "montserrat" }]}><p>Module content</p></WorkspaceShell>);
    const styled = [...container.querySelectorAll<HTMLElement>("[style]")].map((element) => element.getAttribute("style") ?? "").join(";");
    expect(styled).toContain("--wd-");
    expect(styled).not.toMatch(/heading-transform|workspace-font-heading/);
  });

  it("keeps the main workspace navigation visible inside CRM", () => {
    route.pathname = "/workspace/crm/leads";
    render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Sales$/);
  });
  it("collapses and reopens the Work group with pointer and keyboard", async () => {
    route.pathname = "/workspace/projects";
    const user = userEvent.setup();
    render(<WorkspaceShell {...shellProps}><p>Content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    const trigger = navigation.getByRole("button", { name: "Work" });
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
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(expect.arrayContaining(["Projects", "Sales", "Calendar", "Home"]));
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

  it("keeps Client Inbox standalone with direct Home and Calendar links", () => {
    route.pathname = "/workspace/crm/conversations";
    const content = <WorkspaceShell {...shellProps}><CrmProductShell title="Inbox" description="Chats" canView compact><p>Chat content</p></CrmProductShell></WorkspaceShell>;
    expect(renderToString(content)).not.toContain('data-focus="true"');
    const { container } = render(content);
    expect(container.querySelector('[data-focus="true"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to CRM" })).not.toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "Workspace sections" })).not.toBeInTheDocument();
    expect(navigation.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/workspace");
    expect(navigation.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/workspace/crm/follow-ups?view=schedule");
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
  it("names Finance from the route map: breadcrumb, sidebar, Settings gear and window title agree", () => {
    route.pathname = "/workspace/finance/payments";
    const { container } = render(<WorkspaceShell {...shellProps}><p>Finance</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Finance$/);
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Finance" })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector('header a[title="Settings"]')).not.toHaveAttribute("data-active");
    expect(document.title).toBe("Finance · Example Studio");
  });
  it("puts the people directory in People, with People's tabs and no Settings menu", () => {
    const { container } = render(<WorkspaceShell {...shellProps}><p>People</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^People$/);
    expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
    expect(container.querySelector('header a[title="Settings"]')).not.toHaveAttribute("data-active");
    const tabs = screen.getByRole("navigation", { name: "People" });
    expect(within(tabs).getByRole("link", { name: "Directory" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/workspace/teams");
    expect(within(tabs).getByRole("link", { name: "Roles" })).toHaveAttribute("href", "/workspace/roles");
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "People" })).toHaveAttribute("href", "/workspace/members");
    expect(document.title).toBe("People · Example Studio");
  });
  it("lights the People tab of the area a HR page belongs to", () => {
    route.pathname = "/workspace/hrms/leave";
    render(<WorkspaceShell {...shellProps}><p>Leave</p></WorkspaceShell>);
    expect(within(screen.getByRole("navigation", { name: "People" })).getByRole("link", { name: "Attendance & leave" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("People");
  });
  it("keeps Settings pages in the Settings menu and links Team and access into People", () => {
    route.pathname = "/workspace/company";
    const { container } = render(<WorkspaceShell {...shellProps}><p>Company</p></WorkspaceShell>);
    const menu = screen.getByRole("navigation", { name: "Settings" });
    expect(within(menu).getByRole("link", { name: "People" })).toHaveAttribute("href", "/workspace/members");
    expect(within(menu).getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/workspace/teams");
    expect(container.querySelector('header a[title="Settings"]')).toHaveAttribute("data-active", "true");
  });
  it("shows Clients on its own, not under Sales", () => {
    route.pathname = "/workspace/crm/customers";
    render(<WorkspaceShell {...shellProps}><p>Clients</p></WorkspaceShell>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Clients$/);
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
    await interaction.click(screen.getByRole("menuitem", { name: "Ask a question" }));
    expect(screen.getByRole("dialog", { name: "Woddy chat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Woddy" })).toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Close Woddy chat" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Woddy chat" })).not.toBeInTheDocument());
  });

  it("offers Woddy's tours from the header: this screen's tour and every tour with its length", async () => {
    const interaction = userEvent.setup();
    route.pathname = "/workspace";
    render(<WorkspaceShell {...shellProps}><p>Workspace content</p></WorkspaceShell>);
    await interaction.click(screen.getByRole("button", { name: "Ask Woddy" }));
    expect(screen.getByRole("menuitem", { name: "Explain this screen" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("menuitem", { name: /Home at a glance\s*\d+ min/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /From enquiry to opportunity/ })).toBeInTheDocument();
  });

  it("has no tours on a phone: the Woddy button opens the chat directly", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 40rem"), addEventListener() {}, removeEventListener() {} }));
    const interaction = userEvent.setup();
    route.pathname = "/workspace";
    route.search = "tour=home";
    render(<WorkspaceShell {...shellProps}><p>Workspace content</p></WorkspaceShell>);
    expect(document.querySelector(".wd-tour")).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Ask Woddy" }));
    expect(screen.queryByRole("menuitem", { name: "Explain this screen" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Woddy chat" })).toBeInTheDocument();
  });
});

describe("Home tabs", () => {
  it("shows Overview, My day, Tasks and Approvals as tabs on Home's pages, with the current one selected", () => {
    route.pathname = "/workspace/approvals";
    render(<WorkspaceShell {...shellProps}><p>Approvals</p></WorkspaceShell>);
    const tabs = within(screen.getByRole("navigation", { name: "Home" }));
    expect(tabs.getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "My day", "Tasks", "Approvals"]);
    expect(tabs.getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
