import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: vi.fn(), applyRotatedSession: vi.fn() }));
vi.mock("@/lib/workspace/workspace-api", async (original) => ({ ...await original<typeof import("@/lib/workspace/workspace-api")>(), isSameOrigin: vi.fn(() => true) }));
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { GET, PUT } from "./route";
import { POST as REVOKE } from "./connections/[connectionId]/route";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const request = (method: string, url: string, body?: unknown) => new Request(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ok = () => vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: new Response(JSON.stringify({ enabled: true, aiEnabled: true, version: 2, canManage: true, connections: [] }), { status: 200 }), unauthenticated: false });
const params = (id: string) => ({ params: Promise.resolve({ connectionId: id }) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isSameOrigin).mockReturnValue(true); });

describe("the AI apps routes", () => {
  it("reads, switches and revokes through the workspace's MCP endpoints", async () => {
    ok();
    expect((await GET(request("GET", `/api/workspace/ai-apps?workspaceId=${workspaceId}`))).status).toBe(200);
    expect((await PUT(request("PUT", "/api/workspace/ai-apps", { workspaceId, enabled: false, version: 2 }))).status).toBe(200);
    expect((await REVOKE(request("POST", `/api/workspace/ai-apps/connections/${connectionId}`, { workspaceId, version: 4 }), params(connectionId))).status).toBe(200);
    const sent = vi.mocked(authenticatedBackendFetch).mock.calls.map(([path, init]) => [path, init?.method, init?.body ? JSON.parse(String(init.body)) : undefined]);
    expect(sent).toEqual([
      [`/workspaces/${workspaceId}/ai/mcp`, "GET", undefined],
      [`/workspaces/${workspaceId}/ai/mcp`, "PUT", { enabled: false, version: 2 }],
      [`/workspaces/${workspaceId}/ai/mcp/connections/${connectionId}/revoke`, "POST", { version: 4 }],
    ]);
  });

  it("refuses other origins and malformed changes before calling Business Core", async () => {
    expect((await GET(request("GET", "/api/workspace/ai-apps?workspaceId=nope"))).status).toBe(400);
    expect((await PUT(request("PUT", "/api/workspace/ai-apps", { workspaceId, enabled: "yes", version: 2 }))).status).toBe(400);
    expect((await REVOKE(request("POST", "/api/workspace/ai-apps/connections/nope", { workspaceId, version: 1 }), params("nope"))).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await PUT(request("PUT", "/api/workspace/ai-apps", { workspaceId, enabled: false, version: 2 }))).status).toBe(403);
    expect((await REVOKE(request("POST", `/api/workspace/ai-apps/connections/${connectionId}`, { workspaceId, version: 1 }), params(connectionId))).status).toBe(403);
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
  });
});
