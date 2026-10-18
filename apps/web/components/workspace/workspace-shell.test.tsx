import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { WorkspaceShell } from "./workspace-shell";
import { renderToString } from "react-dom/server";
import { CrmProductShell } from "../crm/crm-product-shell";

const route = vi.hoisted(() => ({ pathname: "/workspace/members" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const shellProps = {
  modules: workspaceModules,
  user: { email: "admin@example.com", name: "Workspace owner" },
  workspaces: [{ description: "Business workspace", id: "workspace-1", name: "Example Studio" }],
};

afterEach(() => {
  route.pathname = "/workspace/members";
  window.localStorage.clear();
  document.documentElement.dataset.theme = "light";
});

describe("WorkspaceShell theme", () => {
  it("puts permitted module destinations directly in the top bar", () => {
    route.pathname = "/workspace/crm/leads";
    render(<WorkspaceShell {...shellProps} modules={workspaceModules.filter((module) => !["pre-project", "projects"].includes(module.id))}><p>Module content</p></WorkspaceShell>);
    const modules = within(screen.getByRole("navigation", { name: "Modules" }));
    expect(modules.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/workspace/crm", "/workspace/hrms"]);
    expect(modules.getByRole("link", { name: "CRM" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/workspace/company");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Enquiries");
  });

  it.each([
    ["/workspace/pre-projects", "Cases"],
    ["/workspace/pre-projects/master-data", "Master Data"],
  ])("shows the shared pre-execution destinations at %s", (pathname, label) => {
    route.pathname = pathname;
    const { container } = render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    expect(container.querySelector("[data-module-selector]")).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(["Cases", "Master Data", "Supplier Offers", "Quotation Templates"]);
    expect(navigation.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(label);
  });

  it("keeps a focused portfolio sidebar on the projects landing page", () => {
    route.pathname = "/workspace/projects";
    const { container } = render(<WorkspaceShell {...shellProps}><p>Project portfolio</p></WorkspaceShell>);
    expect(container.querySelector("[data-module-selector]")).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(["All projects", "Calendar", "Workflow setup"]);
    expect(navigation.getByRole("link", { name: "All projects" })).toHaveAttribute("aria-current", "page");
  });

  it("opens case sections after leaving the module list and keeps Master Data shared", () => {
    route.pathname = "/workspace/pre-projects";
    const view = render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    const casePath = "/workspace/pre-projects/cases/e56299c6-3da3-402a-a9ac-3995bb37b9d4";
    route.pathname = `${casePath}/requirements`;
    view.rerender(<WorkspaceShell {...shellProps}><p>Case content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Requirements" })).toHaveAttribute("href", `${casePath}/requirements`);
    expect(navigation.getAllByRole("link").map(link=>link.textContent)).toEqual(["Case overview","Requirements","Client inspirations","Design","Scope confirmation","Quotations","Agreement & payments","Change requests","Approvals & release","Client portal"]);
    expect(navigation.queryByRole("link", { name: "Master Data" })).not.toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: "Preparation" })).not.toBeInTheDocument();
    route.pathname = "/workspace/pre-projects/master-data";
    view.rerender(<WorkspaceShell {...shellProps}><p>Catalog content</p></WorkspaceShell>);
    expect(navigation.queryByRole("link", { name: "Requirements" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Requirements" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Cases");
  });

  it("keeps Inbox inside CRM before and after client effects run", () => {
    route.pathname = "/workspace/crm/conversations";
    const content = <WorkspaceShell {...shellProps}><CrmProductShell title="Inbox" description="Chats" canView compact><p>Chat content</p></CrmProductShell></WorkspaceShell>;
    expect(renderToString(content)).not.toContain('data-focus="true"');
    const { container } = render(content);
    expect(container.querySelector('[data-focus="true"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to CRM" })).not.toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    expect(navigation.getByRole("link", { name: "Enquiries" })).toBeInTheDocument();
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
