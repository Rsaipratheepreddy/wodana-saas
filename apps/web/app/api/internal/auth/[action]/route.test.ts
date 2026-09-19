import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  businessApiUrl: (path: string) => `http://business.test${path}`,
  safeBackendMessage: (_payload: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/auth/device-request", () => ({ forwardedDeviceHeaders: () => ({}) }));
vi.mock("@/lib/internal/auth", () => ({
  OPERATOR_COOKIE: "wodana_operator",
  getOperatorSession: vi.fn(),
  operatorCookieOptions: (maxAge: number) => ({ httpOnly: true, sameSite: "strict", secure: false, path: "/", maxAge }),
}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
}));

import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(isSameOrigin).mockReturnValue(true);
});

describe("operator authentication BFF", () => {
  it("rejects a forged origin before contacting Business Core", async () => {
    vi.mocked(isSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://wodana.test/api/internal/auth/login", {
      method: "POST", body: JSON.stringify({ email: "x", password: "y" }),
    }), { params: Promise.resolve({ action: "login" }) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the operator token out of JSON and sets a private strict cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: "verified", sessionToken: "opaque-private-token", expiresInSeconds: 28_800,
      operator: { userId: "operator-id" },
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://wodana.test/api/internal/auth/verify", {
      method: "POST", body: JSON.stringify({ challengeToken: "challenge", code: "123456" }),
    }), { params: Promise.resolve({ action: "verify" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "verified", operator: { userId: "operator-id" } });
    expect(response.headers.get("set-cookie")).toContain("wodana_operator=opaque-private-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
    expect(fetchMock).toHaveBeenCalledWith("http://business.test/auth/platform/mfa/verify", expect.objectContaining({
      cache: "no-store",
    }));
  });
});
