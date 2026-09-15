import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const browser = new Headers({ "user-agent": "Mozilla/5.0 Chrome/152.0.0.0", "x-forwarded-for": "192.0.2.42" });
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => new Map([["wodana_access", { value: "expired" }], ["wodana_refresh", { value: "refresh" }]]),
  headers: async () => browser,
}));
import { authenticatedBackendFetch, authenticatedBackendPost } from "./backend-session";
import { proxy } from "@/proxy";
const rotated = { accessToken: "access-new", refreshToken: "refresh-new", accessTokenExpiresIn: 900, refreshTokenExpiresIn: 86400 };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("device identity through session refresh", () => {
  it("preserves browser and IP when a workspace API rotates its session", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(rotated)).mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await authenticatedBackendFetch("/workspaces/example/crm/leads");
    expect(result.unauthenticated).toBe(false);
    expect(result.rotatedSession).toEqual(rotated);
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ "user-agent": browser.get("user-agent"), "x-forwarded-for": "192.0.2.42" });
  });
  it("uses the rotated refresh token when retrying a protected security action", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(rotated)).mockResolvedValueOnce(Response.json({ enabled: true }));
    vi.stubGlobal("fetch", fetcher);
    const result = await authenticatedBackendPost("/security/mfa/totp/setup", { workspaceId: "00000000-0000-4000-8000-000000000002" });
    expect(result.unauthenticated).toBe(false);
    expect(result.rotatedSession).toEqual(rotated);
    expect(JSON.parse(String(fetcher.mock.calls[2][1].body))).toMatchObject({ refreshToken: "refresh-new" });
    expect(fetcher.mock.calls[2][1].headers.get("authorization")).toBe("Bearer access-new");
  });
  it("preserves browser and IP when opening a page after token expiry", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(rotated));
    vi.stubGlobal("fetch", fetcher);
    const request = new NextRequest("http://localhost/workspace/crm/leads", { headers: browser });
    request.cookies.set("wodana_access", "expired"); request.cookies.set("wodana_refresh", "refresh");
    const response = await proxy(request);
    expect(response.cookies.get("wodana_access")?.value).toBe("access-new");
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ "user-agent": browser.get("user-agent"), "x-forwarded-for": "192.0.2.42" });
  });
});
