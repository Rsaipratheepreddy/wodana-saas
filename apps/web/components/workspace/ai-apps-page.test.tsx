import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { canOpen } from "@/lib/workspace/access";
import type { McpConnection, McpOverview } from "@/lib/workspace/ai-apps";
import { workspaceModules } from "./workspace-navigation";
import { AiAppsPage } from "./ai-apps-page";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const MINE = "00000000-0000-4000-8000-0000000000a1", THEIRS = "00000000-0000-4000-8000-0000000000a2";
const connection = (patch: Partial<McpConnection> = {}): McpConnection => ({
  id: MINE, clientName: "Claude", userId: "u-1", userName: "Maya Admin", mine: true, scopes: ["read", "write"],
  createdAt: "2026-09-20T08:00:00Z", lastUsedAt: "2026-09-28T10:00:00Z", version: 2, ...patch,
});
const overview = (patch: Partial<McpOverview> = {}): McpOverview => ({
  enabled: true, aiEnabled: true, version: 3, canManage: true,
  connections: [connection(), connection({ id: THEIRS, clientName: "ChatGPT", userId: "u-2", userName: "Sam Sales", mine: false, scopes: ["read"], lastUsedAt: null, version: 5 })],
  ...patch,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const renderPage = () => render(<DesignSystemProvider locale="en-US" timeZone="UTC"><AiAppsPage workspaceId={workspaceId} /></DesignSystemProvider>);
const calls = (fetcher: ReturnType<typeof vi.fn>, method: string) => fetcher.mock.calls
  .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
  .map(([url, init]) => ({ url, body: JSON.parse(String((init as RequestInit).body)) }));

afterEach(() => vi.unstubAllGlobals());

describe("Settings → AI apps", () => {
  it("shows the switch, the connector address and every connected app with its access", async () => {
    const fetcher = vi.fn(async () => json(200, overview()));
    vi.stubGlobal("fetch", fetcher);
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "AI apps" })).toBeInTheDocument();
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`/api/workspace/ai-apps?workspaceId=${workspaceId}`);
    expect(screen.getByRole("switch", { name: "AI apps can connect" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "AI apps can connect" })).toBeEnabled();
    expect(screen.getByText(`${window.location.origin}/api/v1/mcp`)).toHaveAttribute("dir", "ltr");
    const table = screen.getByRole("table", { name: "Connected apps" });
    expect(within(table).getByText("Claude")).toBeInTheDocument();
    expect(within(table).getByText("Sam Sales")).toBeInTheDocument();
    expect(within(table).getByText("Read and prepare changes")).toBeInTheDocument();
    expect(within(table).getByText("Read")).toBeInTheDocument();
    expect(within(table).getByText("Not yet")).toBeInTheDocument();
    // Administrators revoke anyone's.
    expect(within(table).getAllByRole("button", { name: "Revoke" })).toHaveLength(2);
  });

  it("switches AI apps off with the version read, and reloads when someone changed it meanwhile", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? json(200, overview({ enabled: false, version: 4 })) : json(200, overview()));
    vi.stubGlobal("fetch", fetcher);
    renderPage();
    await userEvent.click(await screen.findByRole("switch", { name: "AI apps can connect" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "AI apps can connect" })).not.toBeChecked());
    expect(calls(fetcher, "PUT")).toEqual([{ url: "/api/workspace/ai-apps", body: { workspaceId, enabled: false, version: 3 } }]);

    const stale = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT"
      ? json(409, { message: "Someone else changed this. Reload and try again." }) : json(200, overview({ enabled: false, version: 9 })));
    vi.stubGlobal("fetch", stale);
    await userEvent.click(screen.getByRole("switch", { name: "AI apps can connect" }));
    expect(await screen.findByText("Someone else changed this. Reload and try again.")).toBeInTheDocument();
    await waitFor(() => expect(stale.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method)).toHaveLength(1));
  });

  it("keeps the switch off for people who don't manage AI apps, and until AI assistance is on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, overview({ canManage: false, connections: [connection(), connection({ id: THEIRS, mine: false, clientName: "ChatGPT" })] }))));
    const { unmount } = renderPage();
    expect(await screen.findByRole("switch", { name: "AI apps can connect" })).toBeDisabled();
    const table = screen.getByRole("table", { name: "Connected apps" });
    // Only their own app can be revoked; whose it is isn't shown to them.
    expect(within(table).getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    expect(within(table).queryByRole("columnheader", { name: "Person" })).not.toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, overview({ aiEnabled: false, enabled: false }))));
    renderPage();
    expect(await screen.findByRole("switch", { name: "AI apps can connect" })).toBeDisabled();
    expect(screen.getByText("Turn on AI assistance first.")).toBeInTheDocument();
  });

  it("revokes an app after asking, with the connection's version", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? json(200, overview({ connections: [overview().connections[1]] })) : json(200, overview()));
    vi.stubGlobal("fetch", fetcher);
    renderPage();
    const table = await screen.findByRole("table", { name: "Connected apps" });
    const claudeRow = within(table).getByText("Claude").closest("tr") as HTMLElement;
    await userEvent.click(within(claudeRow).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Claude?" });
    expect(within(dialog).getByText("Claude loses access to this workspace.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls(fetcher, "POST")).toEqual([{ url: `/api/workspace/ai-apps/connections/${MINE}`, body: { workspaceId, version: 2 } }]);
    expect(within(screen.getByRole("table", { name: "Connected apps" })).queryByText("Claude")).not.toBeInTheDocument();
  });

  it("says when no AI app is connected, retries a failed load and locks without access", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(503, { message: "The workspace service is unavailable." })).mockResolvedValue(json(200, overview({ connections: [] })));
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No AI apps connected")).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { message: "Forbidden" })));
    renderPage();
    expect(await screen.findByText("You don't have access to AI apps")).toBeInTheDocument();
  });

  it("is a Connections setting for everyone who can ask Woddy", () => {
    const connections = workspaceModules.find((module) => module.id === "workspace")!.navigation.find((group) => group.id === "workspace-connections")!;
    expect(connections.items.find((item) => item.id === "ai-apps")).toMatchObject({ href: "/workspace/settings/ai-apps" });
    expect(canOpen("ai-apps", { permissions: ["ai.suggestions.use"] })).toBe(true);
    expect(canOpen("ai-apps", { permissions: ["workspace.settings.manage"] })).toBe(true);
    expect(canOpen("ai-apps", { roles: ["owner"] })).toBe(true);
    expect(canOpen("ai-apps", { permissions: ["crm.leads.view"] })).toBe(false);
  });
});
