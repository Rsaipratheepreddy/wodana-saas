import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { viewAsReturnPath, viewAsTimeLeft } from "@/lib/workspace/view-as";
import { ViewAsBanner } from "./view-as-banner";

const workspaceId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-0000000000aa";

describe("the view-as banner", () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("exit")
      ? { returnPath: "/workspace/settings/members" }
      : { authenticated: true, profile: { viewAs: { sessionId } } }), { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); assign.mockReset(); });

  const summary = (expiresInMs: number) => ({
    sessionId, workspaceId, kind: "person" as const, subjectName: "Sara Sales", subjectRoleLabel: "Sales",
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + expiresInMs).toISOString(), returnPath: "/workspace/settings/members",
  });

  it("says who, read-only and the time left, and Exit returns to the page the viewer came from", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><ViewAsBanner viewAs={summary(29 * 60_000 + 5_000)} /></DesignSystemProvider>);
    const banner = screen.getByRole("region", { name: "View as" });
    expect(banner).toHaveTextContent("Viewing as Sara Sales (Sales)");
    expect(banner).toHaveTextContent("Read-only");
    expect(banner).toHaveTextContent(/29:0[45] left/);
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(fetch).toHaveBeenCalledWith("/api/workspace/view-as/exit", expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId, sessionId }) }));
    expect(assign).toHaveBeenCalledWith("/workspace/settings/members");
  });

  it("ends the view the same way when the time is up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DesignSystemProvider><ViewAsBanner viewAs={summary(1_500)} /></DesignSystemProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetch).toHaveBeenCalledWith("/api/workspace/view-as/exit", expect.anything());
    expect(assign).toHaveBeenCalledWith("/workspace/settings/members");
  });

  it("names a role preview and formats the time left", () => {
    render(<DesignSystemProvider><ViewAsBanner viewAs={{ ...summary(60_000), kind: "role", subjectName: "Sales", subjectRoleLabel: "Sales" }} /></DesignSystemProvider>);
    expect(screen.getByRole("region", { name: "View as" })).toHaveTextContent("Previewing Sales");
    expect(viewAsTimeLeft("2026-09-29T10:30:00Z", Date.parse("2026-09-29T10:00:30Z"))).toBe("29:30");
    expect(viewAsTimeLeft("2026-09-29T10:30:00Z", Date.parse("2026-09-29T11:00:00Z"))).toBe("00:00");
    expect(viewAsReturnPath("https://example.com")).toBe("/workspace");
    expect(viewAsReturnPath("/workspace/crm")).toBe("/workspace/crm");
  });
});
