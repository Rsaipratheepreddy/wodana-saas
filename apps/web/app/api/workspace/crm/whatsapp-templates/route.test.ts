import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/workspace/workspace-api", () => ({
 UUID: /^[0-9a-f-]{36}$/,
 isSameOrigin: (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === "http://localhost",
 invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-token" }) }) }));
vi.mock("@/lib/auth/server", () => ({ ACCESS_COOKIE: "access", businessApiUrl: (path: string) => `http://core${path}`, intelligenceApiUrl: (path: string) => `http://providers${path}`, safeBackendMessage: (_data: unknown, fallback: string) => fallback }));
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: vi.fn(), applyRotatedSession: vi.fn() }));
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { POST } from "./route";
const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390", connectionId = "97f422fe-89ee-41d6-ba31-28372af2a3d6";
const meta = { id: "provider-template", name: "business_update", language: "en_US", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Your update is ready." }] };
const stored = { id: "local-template", providerTemplateId: meta.id, code: meta.name, locale: "en_US", channel: "whatsapp", status: "draft", versionNumber: 1, bodyTemplate: "Your update is ready." };
const request = () => new Request("http://localhost/api/workspace/crm/whatsapp-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, connectionId }) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: Response.json([]), unauthenticated: false }); });
describe("WhatsApp template synchronization", () => {
  it("imports only real approved static business templates, without sending messages", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [meta, { ...meta, id: "otp", category: "AUTHENTICATION" }, { ...meta, status: "PENDING" }] })).mockResolvedValueOnce(Response.json(stored)).mockResolvedValueOnce(Response.json({ status: "approved" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.items).toEqual([{ ...stored, status: "approved" }]);
    expect(result.unavailable[0].reason).toContain("portal login");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("operations") && !String(url).includes("messages"))).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ code: meta.name, providerTemplateId: meta.id, variables: [] });
  });
  it("reuses existing approval without creating a version on every refresh", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: Response.json([{ ...stored, status: "approved" }]), unauthenticated: false });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [meta] }));
    vi.stubGlobal("fetch", fetcher);
    expect((await (await POST(request())).json()).items).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose stale local approval if Meta has removed it", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({ upstream: Response.json([{ ...stored, status: "approved" }]), unauthenticated: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [] })));
    expect((await (await POST(request())).json()).items).toEqual([]);
  });
  it("preserves permission checks and reports provider failure rather than an empty library", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Denied" }, { status: 403 })));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).message).toContain("Meta templates");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-site synchronization before any backend access", async () => {
    const crossSite = request(); crossSite.headers.set("origin", "https://untrusted.example");
    expect((await POST(crossSite)).status).toBe(400);
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
  });
});
