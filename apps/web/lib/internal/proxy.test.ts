import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ getOperatorSession: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  businessApiUrl: (path: string) => `http://business.test${path}`,
  safeBackendMessage: (_payload: unknown, fallback: string) => fallback,
}));

import { getOperatorSession } from "./auth";
import { internalJsonResponse } from "./proxy";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BUSINESS_CORE_INTERNAL_TOKEN", "test-internal-token");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("internal portal API boundary", () => {
  it("denies a tenant-only session before contacting the internal Business Core endpoint", async () => {
    vi.mocked(getOperatorSession).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await internalJsonResponse("/internal/operator/tenants/tenant-1/status", { method: "GET" }, "Unavailable");

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies an operator using both the server-held credential and operator assertion", async () => {
    vi.mocked(getOperatorSession).mockResolvedValue({
      token: "operator-session",
      operator: {
        userId: "operator-id", email: "operator@wodana.test", displayName: "Operator", expiresAt: "",
        role: "support_observer", permissions: ["tenants.read", "support.request"],
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ seats: { reserved: 3 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await internalJsonResponse("/internal/operator/tenants/tenant-1/status", { method: "GET" }, "Unavailable");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seats: { reserved: 3 } });
    expect(fetchMock).toHaveBeenCalledWith("http://business.test/internal/operator/tenants/tenant-1/status", expect.objectContaining({
      cache: "no-store",
      headers: expect.objectContaining({
        "x-wodana-internal-token": "test-internal-token",
        "x-wodana-operator-session": "operator-session",
      }),
    }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
