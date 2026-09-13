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
  useRouter: () => ({ push: vi.fn() }),
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
  it.each([
    ["/workspace/pre-projects", "Qualified leads"],
    ["/workspace/pre-projects/master-data", "Master Data"],
  ])("shows the two module destinations at %s", (pathname, label) => {
    route.pathname = pathname;
    const { container } = render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    expect(container.querySelector("[data-module-selector]")).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual(["Qualified leads", "Master Data", "Quotation Templates"]);
    expect(navigation.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(label);
  });

  it("opens case sections after leaving the module list and keeps Master Data shared", () => {
    route.pathname = "/workspace/pre-projects";
    const view = render(<WorkspaceShell {...shellProps}><p>Module content</p></WorkspaceShell>);
    const casePath = "/workspace/pre-projects/cases/e56299c6-3da3-402a-a9ac-3995bb37b9d4";
    route.pathname = `${casePath}/requirements`;
    view.rerender(<WorkspaceShell {...shellProps}><p>Case content</p></WorkspaceShell>);
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getByRole("link", { name: "Requirements" })).toHaveAttribute("href", `${casePath}/requirements`);
    expect(navigation.getAllByRole("link").map(link=>link.textContent)).toEqual(["Requirements","Client inspirations","Design","Quotations","Agreement & payments","Change requests","Approvals & release","Client portal"]);
    expect(navigation.queryByRole("link", { name: "Master Data" })).not.toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: "Preparation" })).not.toBeInTheDocument();
    route.pathname = "/workspace/pre-projects/master-data";
    view.rerender(<WorkspaceShell {...shellProps}><p>Catalog content</p></WorkspaceShell>);
    expect(navigation.queryByRole("link", { name: "Requirements" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Requirements" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Qualified leads");
  });

  it.each(["automations"])("renders %s as full-page before client effects run", (section) => {
    route.pathname = `/workspace/crm/${section}`;
    const html = renderToString(<WorkspaceShell {...shellProps}><p>CRM content</p></WorkspaceShell>);
    expect(html).toContain('data-focus="true"');
    expect(html).toContain("Back to CRM");
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
    expect(navigation.getByRole("link", { name: "Leads" })).toBeInTheDocument();
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
