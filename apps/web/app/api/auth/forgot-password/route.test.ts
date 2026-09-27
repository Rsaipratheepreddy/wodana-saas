import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });

vi.mock("@/lib/auth/resolve-tenant-host", () => ({ resolveTenantHost: vi.fn() }));

import { resolveTenantHost } from "@/lib/auth/resolve-tenant-host";
import { POST } from "./route";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("password recovery BFF", () => {
  const url = "http://localhost:3102/api/auth/forgot-password";

  it("on the platform host without a tenant, asks for email-first recovery instead of a fixed tenant", async () => {
    vi.stubEnv("LOGIN_TENANT_SLUG", "");
    vi.mocked(resolveTenantHost).mockResolvedValue({ kind: "generic" });
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", upstream);
    const response = await POST(new Request(url, { method: "POST", headers: { host: "localhost:3102" }, body: JSON.stringify({ email: "owner@example.test" }) }));
    expect(response.status).toBe(202);
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({ email: "owner@example.test", tenantSlug: "" });
  });

  it("uses the tenant bound to the login address", async () => {
    vi.mocked(resolveTenantHost).mockResolvedValue({
      kind: "tenant",
      branding: { displayName: "Palm", loginSlug: "plm", logoUrl: null, primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", upstream);
    await POST(new Request(url, { method: "POST", headers: { host: "plm.example.com" }, body: JSON.stringify({ email: "owner@example.test" }) }));
    expect(JSON.parse(upstream.mock.calls[0][1].body).tenantSlug).toBe("plm");
  });
});
