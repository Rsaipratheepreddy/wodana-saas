// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
const forward = vi.hoisted(() => vi.fn());
const backend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspace/workspace-api", () => ({ UUID: /^[0-9a-f-]{36}$/, isSameOrigin: (request: Request) => request.headers.get("origin") !== "https://other.test", workspaceJsonResponse: forward }));
vi.mock("@/lib/auth/backend-session", () => ({ authenticatedBackendFetch: backend, applyRotatedSession: () => undefined }));
import { GET, POST } from "./route";

const w = "11111111-1111-4111-8111-111111111111", o = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333", f = "44444444-4444-4444-8444-444444444444";
const params = (...path: string[]) => ({ params: Promise.resolve({ path }) });

describe("factory proxy: quality check photos", () => {
  beforeEach(() => { forward.mockReset(); backend.mockReset(); });

  it("passes a check's photo through as a file, and only a photo", async () => {
    forward.mockResolvedValue(new Response("{}"));
    const form = new FormData();
    form.set("file", new File(["x"], "check.jpg", { type: "image/jpeg" }));
    await POST(new Request(`http://localhost/api/factory/orders/${o}/checks/${c}/photos/${f}?workspaceId=${w}`, { method: "POST", body: form }), params("orders", o, "checks", c, "photos", f));
    expect(forward).toHaveBeenCalledWith(`/workspaces/${w}/factory/orders/${o}/checks/${c}/photos/${f}`, expect.objectContaining({ method: "POST", body: expect.any(FormData) }), expect.any(String));
    const text = new FormData();
    text.set("file", new File(["x"], "notes.txt", { type: "text/plain" }));
    const refused = await POST(new Request(`http://localhost/api/factory/orders/${o}/checks/${c}/photos/${f}?workspaceId=${w}`, { method: "POST", body: text }), params("orders", o, "checks", c, "photos", f));
    expect(refused.status).toBe(400);
    expect((await POST(new Request(`http://localhost/api/factory/orders/${o}/checks/bad/photos/${f}?workspaceId=${w}`, { method: "POST", body: form }), params("orders", o, "checks", "bad", "photos", f))).status).toBe(400);
  });

  it("streams a check's photo back, its preview when asked", async () => {
    backend.mockResolvedValue({ upstream: new Response("img", { headers: { "content-type": "image/webp" } }), rotatedSession: null });
    const response = await GET(new Request(`http://localhost/api/factory/photos/${f}?workspaceId=${w}&preview=1`), params("photos", f));
    expect(backend).toHaveBeenCalledWith(`/workspaces/${w}/factory/photos/${f}?preview=1`, { cache: "no-store" });
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/webp"]);
  });
});
