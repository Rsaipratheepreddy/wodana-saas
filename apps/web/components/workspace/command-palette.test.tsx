import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { CommandPalette, paletteDestinations } from "./command-palette";

const push = vi.fn();
const ask = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/crm/woddy-chat", () => ({ useWoddy: () => ({ ask }) }));

const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";
const sales = { permissions: ["crm.leads.view", "crm.leads.manage", "crm.activities.view", "crm.activities.manage", "ai.suggestions.use"], roles: ["sales"] };

function stubFetch({ aiEnabled }: { aiEnabled: boolean }) {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).startsWith("/api/workspace/ai-settings")
    ? { enabled: aiEnabled, available: true, version: 1 }
    : { query: "villa", searchedKinds: ["project"], truncated: false, items: [{ id: "p1", kind: "project", title: "Villa 12", subtitle: "Project · Maya", reference: "PRJ-0007", route: "/workspace/projects/p1/overview" }] } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("⌘K (NV-2)", () => {
  beforeEach(() => { push.mockReset(); ask.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("L18: never opens from a field in a side panel or dialog, and leaves a page's own ⌘K to the page", async () => {
    stubFetch({ aiEnabled: false });
    const user = userEvent.setup();
    render(<><CommandPalette workspaceId={workspaceId} modules={workspaceModules} access={sales} />
      <aside data-side-panel><input aria-label="Search the catalog" type="search" /></aside><input aria-label="Page field" /></>);
    await user.click(screen.getByRole("searchbox", { name: "Search the catalog" }));
    await user.keyboard("Harriet{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Search and act" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search the catalog" })).toHaveValue("Harriet");
    const own = (event: KeyboardEvent) => { if (event.key === "k") event.preventDefault(); };
    document.addEventListener("keydown", own);
    try {
      await user.click(screen.getByRole("textbox", { name: "Page field" }));
      await user.keyboard("{Control>}k{/Control}");
      expect(screen.queryByRole("dialog", { name: "Search and act" })).not.toBeInTheDocument();
    } finally { document.removeEventListener("keydown", own); }
    expect(push).not.toHaveBeenCalled();
  });

  it("opens from anywhere with the keyboard and creates what the person may create", async () => {
    stubFetch({ aiEnabled: false });
    const user = userEvent.setup();
    render(<CommandPalette workspaceId={workspaceId} modules={workspaceModules} access={sales} />);
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Search and act" });
    const input = within(dialog).getByRole("searchbox", { name: "Search records, pages and actions" });
    expect(input).toHaveFocus();
    await user.type(input, "enquiry");
    const options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveTextContent("New enquiry");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    // Nobody without the permission is offered it.
    expect(within(dialog).queryByRole("option", { name: /Start planning/ })).toBeNull();
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/workspace/crm/leads?create=true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds records with the workspace search and opens one with the arrow keys", async () => {
    stubFetch({ aiEnabled: false });
    const user = userEvent.setup();
    render(<CommandPalette workspaceId={workspaceId} modules={workspaceModules} access={sales} />);
    await user.click(screen.getByRole("button", { name: /Search and act/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search records, pages and actions" }), "villa");
    expect(await screen.findByRole("option", { name: /Villa 12/ })).toHaveTextContent("PRJ-0007");
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(push).toHaveBeenCalledWith("/workspace/projects/p1/overview");
  });

  it("hands the words to Woddy, only while AI is on", async () => {
    stubFetch({ aiEnabled: true });
    const user = userEvent.setup();
    const view = render(<CommandPalette workspaceId={workspaceId} modules={workspaceModules} access={sales} />);
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("searchbox", { name: "Search records, pages and actions" }), "which quotes wait");
    await user.click(await screen.findByRole("option", { name: "Ask Woddy: which quotes wait" }));
    expect(ask).toHaveBeenCalledWith("which quotes wait");
    view.unmount();

    stubFetch({ aiEnabled: false });
    render(<CommandPalette workspaceId={workspaceId} modules={workspaceModules} access={sales} />);
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("searchbox", { name: "Search records, pages and actions" }), "which quotes wait");
    await waitFor(() => expect(screen.queryByRole("option", { name: /Ask Woddy/ })).toBeNull());
  });

  it("lists every page the navigation offers, once", () => {
    const pages = paletteDestinations(workspaceModules);
    expect(new Set(pages.map((page) => page.href)).size).toBe(pages.length);
    expect(pages.some((page) => page.href === "/workspace/crm/leads")).toBe(true);
  });
});
