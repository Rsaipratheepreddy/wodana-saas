import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { APPROVALS_CHANGED } from "@/components/approvals/use-waiting-count";
import type { WoddyCard } from "@/lib/woddy/agent";
import { moduleForWorkspacePath } from "@/lib/workspace/module-rollout";
import { accessRuleForPath } from "@/lib/workspace/access";
import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";
import { AiActionPage } from "./ai-action-page";

const WS = "00000000-0000-4000-8000-000000000001";
const CALL = "00000000-0000-4000-8000-0000000000c1";
const card = (patch: Partial<WoddyCard> = {}): WoddyCard => ({
  id: CALL, runId: "r-1", tool: "update_enquiry", status: "proposed", title: { key: "Update {record}", values: { record: "ENQ-118" } }, summary: "Update ENQ-118",
  version: 1, selection: null, record: null, failures: [], error: null, target: null, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  preview: { kind: "fields", fields: [{ label: "Area", before: "Hills", after: "Palm view" }] }, surface: "mcp", clientName: "Claude", ...patch,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const show = () => render(<DesignSystemProvider><AiActionPage workspaceId={WS} toolCallId={CALL} /></DesignSystemProvider>);
afterEach(() => vi.unstubAllGlobals());

describe("A change an AI app prepared", () => {
  it("shows what the app prepared, by whom, and updates Approvals once decided", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? json(200, card({ status: "executed", version: 2 })) : json(200, card()));
    vi.stubGlobal("fetch", fetcher);
    const changed = vi.fn();
    window.addEventListener(APPROVALS_CHANGED, changed);
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Waiting for your OK" })).toBeInTheDocument();
    const action = await screen.findByRole("region", { name: "Woddy action" });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`/api/workspace/woddy/tool-calls/${CALL}?workspaceId=${WS}`);
    expect(screen.getByText("Prepared by Claude")).toBeInTheDocument();
    expect(action).toHaveTextContent("Update ENQ-118");
    expect(within(action).getByText("Palm view")).toBeInTheDocument();
    await userEvent.click(within(action).getByRole("button", { name: "Confirm" }));
    expect(await within(action).findByText("Done")).toBeInTheDocument();
    await waitFor(() => expect(changed).toHaveBeenCalled());
    window.removeEventListener(APPROVALS_CHANGED, changed);
  });

  it("says when the change isn't there, and retries when it didn't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { message: "This Woddy action was not found." })));
    const { unmount } = show();
    expect(await screen.findByText("This Woddy action was not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    unmount();
    const fetcher = vi.fn().mockResolvedValueOnce(json(503, { message: "The workspace service is unavailable." })).mockResolvedValue(json(200, card({ clientName: null, surface: "panel" })));
    vi.stubGlobal("fetch", fetcher);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Woddy action" })).toBeInTheDocument();
    expect(screen.queryByText(/Prepared by/)).not.toBeInTheDocument();
  });

  it("opens for any member, under Approvals", () => {
    expect(moduleForWorkspacePath(`/workspace/ai-actions/${CALL}`)).toBe("workspace");
    expect(accessRuleForPath(`/workspace/ai-actions/${CALL}`)).toBeUndefined();
    const route = resolveWorkspaceRoute(`/workspace/ai-actions/${CALL}`);
    expect([...route.trail.map((item) => item.label), route.label]).toEqual(["Home", "Approvals", "Waiting for your OK"]);
  });
});
