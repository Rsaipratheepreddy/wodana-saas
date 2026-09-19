import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/resolve-tenant-host", () => ({ resolveTenantHost: vi.fn() }));

import { resolveTenantHost } from "@/lib/auth/resolve-tenant-host";
import { POST } from "./route";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("tenant-bound login BFF", () => {
  const url = "http://localhost:3102/api/auth/login";

  it("rejects a stale or unknown custom hostname before attempting authentication", async () => {
    vi.mocked(resolveTenantHost).mockResolvedValue(null);
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await POST(new Request(url, { method: "POST", headers: { host: "unbound.example.com" }, body: JSON.stringify({ email: "owner@example.com", password: "secret", tenantSlug: "plm" }) }));
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a forged tenant slug on an otherwise bound hostname", async () => {
    vi.mocked(resolveTenantHost).mockResolvedValue({
      kind: "tenant",
      branding: {
        displayName: "Palm", loginSlug: "plm", logoUrl: null, primaryColor: null,
        secondaryColor: null, headingFont: null, bodyFont: null,
      },
    });
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await POST(new Request(url, { method: "POST", headers: { host: "portal.example.com" }, body: JSON.stringify({ email: "owner@example.com", password: "secret", tenantSlug: "another" }) }));
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
