import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal/proxy", () => ({ internalJsonResponse: vi.fn(async () => Response.json({ ok: true })) }));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}));

import { internalJsonResponse } from "@/lib/internal/proxy";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { GET as listDomains, POST as requestDomain } from "./[externalTenantId]/domains/route";
import { POST as actionDomain } from "./[externalTenantId]/domains/[domainId]/[action]/route";

afterEach(() => { vi.clearAllMocks(); vi.mocked(isSameOrigin).mockReturnValue(true); });

describe("operator domain BFF routes", () => {
  const tenant = "tenant_test";
  const domainId = "00000000-0000-4000-8000-000000000111";

  it("lists domains only through the operator proxy", async () => {
    await listDomains(new Request(`http://wodana.test/api/internal/tenants/${tenant}/domains`), { params: Promise.resolve({ externalTenantId: tenant }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(`/internal/operator/tenants/${tenant}/domains`, { method: "GET" }, expect.any(String));
  });

  it("requires same origin and a stable request key before reserving", async () => {
    const url = `http://wodana.test/api/internal/tenants/${tenant}/domains`;
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await requestDomain(new Request(url, { method: "POST", body: "{}" }), { params: Promise.resolve({ externalTenantId: tenant }) })).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(true);
    expect((await requestDomain(new Request(url, { method: "POST", body: "{}" }), { params: Promise.resolve({ externalTenantId: tenant }) })).status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();
    await requestDomain(new Request(url, { method: "POST", headers: { "idempotency-key": "domain-key" }, body: JSON.stringify({ hostname: "portal.example.com" }) }), { params: Promise.resolve({ externalTenantId: tenant }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(`/internal/operator/tenants/${tenant}/domains`, expect.objectContaining({ headers: expect.objectContaining({ "idempotency-key": "domain-key" }) }), expect.any(String));
  });

  it("allows only known versioned actions with a valid domain ID", async () => {
    const request = new Request(`http://wodana.test/api/internal/tenants/${tenant}/domains/${domainId}/verify`, { method: "POST", body: JSON.stringify({ expectedVersion: 1 }) });
    expect((await actionDomain(request, { params: Promise.resolve({ externalTenantId: tenant, domainId, action: "activate" }) })).status).toBe(400);
    expect((await actionDomain(request, { params: Promise.resolve({ externalTenantId: tenant, domainId: "not-a-uuid", action: "verify" }) })).status).toBe(400);
    await actionDomain(request, { params: Promise.resolve({ externalTenantId: tenant, domainId, action: "verify" }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(`/internal/operator/tenants/${tenant}/domains/${domainId}/verify`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 1 }) }), expect.any(String));
    const recheckRequest = new Request(request.url, { method: "POST", body: JSON.stringify({ expectedVersion: 1 }) });
    await actionDomain(recheckRequest, { params: Promise.resolve({ externalTenantId: tenant, domainId, action: "recheck" }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(`/internal/operator/tenants/${tenant}/domains/${domainId}/recheck`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 1 }) }), expect.any(String));
  });
});
