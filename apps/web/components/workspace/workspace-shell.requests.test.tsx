import { StrictMode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceModules } from "./workspace-navigation";
import { WorkspaceShell } from "./workspace-shell";

const route = vi.hoisted(() => ({ pathname: "/workspace/projects" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const workspaceId = "a01f8d25-3678-4631-a7bb-7d665785d521";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, data = "") { for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent<string>); }
  close() { this.closed = true; }
}

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = []; route.pathname = "/workspace/projects"; });

// The live stream is shared per workspace for the whole tab, so each test uses its own workspace.
const shellProps = (id: string) => ({
  canManageWorkspace: true,
  modules: workspaceModules,
  user: { email: "owner@example.com", name: "Owner", id: "user-1" },
  workspaces: [{ description: "Business workspace", id, name: "Example Studio", imageUrl: "/api/auth/tenant-logo/example?v=1&variant=square" }],
});

function respond(url: string) {
  if (url.includes("/setup-readiness")) return { company: true, regional: true, tax: false, people: true, proposalKit: false, connections: false };
  if (url.includes("/approvals")) return { count: 0 };
  return [];
}

/** Requests per path (query ignored), excluding the ones the test does not care about. */
const counts = (fetcher: ReturnType<typeof vi.fn>) => {
  const result: Record<string, number> = {};
  for (const [input] of fetcher.mock.calls) {
    const path = String(input).split("?")[0];
    result[path] = (result[path] ?? 0) + 1;
  }
  return result;
};

describe("workspace shell requests (D11)", () => {
  it("reads each shell resource once per page, opens one live stream, and asks nothing again on a re-render or when the stream goes live", async () => {
    const fetcher = vi.fn(async (input: string | URL) => ({ ok: true, status: 200, json: async () => respond(String(input)) }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("EventSource", FakeEventSource);
    const props = shellProps(workspaceId);
    const view = render(<StrictMode><WorkspaceShell {...props}><p>Page</p></WorkspaceShell></StrictMode>);
    await waitFor(() => expect(counts(fetcher)["/api/workspace/setup-readiness"]).toBe(1));
    await waitFor(() => expect(counts(fetcher)["/api/workspace/crm/data/notifications"]).toBe(1));

    // The stream opening only slows polling; it must not read the notices again.
    await act(async () => { FakeEventSource.instances.forEach((source) => source.emit("open")); });
    view.rerender(<StrictMode><WorkspaceShell {...props}><p>Page again</p></WorkspaceShell></StrictMode>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    const seen = counts(fetcher);
    expect(seen["/api/workspace/crm/data/notifications"]).toBe(1);
    expect(seen["/api/workspace/setup-readiness"]).toBe(1);
    for (const [path, count] of Object.entries(seen)) expect({ path, count }).toEqual({ path, count: 1 });
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("keeps the same reads and stream when moving to another page of the workspace", async () => {
    const fetcher = vi.fn(async (input: string | URL) => ({ ok: true, status: 200, json: async () => respond(String(input)) }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("EventSource", FakeEventSource);
    const props = shellProps("b02f8d25-3678-4631-a7bb-7d665785d522");
    const view = render(<StrictMode><WorkspaceShell {...props}><p>Projects</p></WorkspaceShell></StrictMode>);
    await waitFor(() => expect(counts(fetcher)["/api/workspace/crm/data/notifications"]).toBe(1));
    route.pathname = "/workspace/crm/leads";
    view.rerender(<StrictMode><WorkspaceShell {...props}><p>Enquiries</p></WorkspaceShell></StrictMode>);
    route.pathname = "/workspace/pre-projects";
    view.rerender(<StrictMode><WorkspaceShell {...props}><p>Planning</p></WorkspaceShell></StrictMode>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const seen = counts(fetcher);
    expect(seen["/api/workspace/crm/data/notifications"]).toBe(1);
    expect(seen["/api/workspace/setup-readiness"]).toBe(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
