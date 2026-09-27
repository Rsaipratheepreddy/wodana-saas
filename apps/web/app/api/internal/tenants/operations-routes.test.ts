import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });

vi.mock("@/lib/internal/proxy", () => ({
  internalJsonResponse: vi.fn(async () => Response.json({ ok: true })),
  internalBinaryResponse: vi.fn(async () => new Response("export")),
}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}));

import { internalBinaryResponse, internalJsonResponse } from "@/lib/internal/proxy";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { GET as overview } from "./[externalTenantId]/operations/route";
import { PATCH as updateResource } from "./[externalTenantId]/operations/[resource]/route";
import { POST as requestSupport } from "./[externalTenantId]/operations/support-sessions/route";
import { POST as decideSupport } from "./[externalTenantId]/operations/support-sessions/[sessionId]/decision/route";
import { POST as planOperation } from "./[externalTenantId]/operations/plans/route";
import { POST as decideOperation } from "./[externalTenantId]/operations/[resource]/decision/route";
import { GET as downloadExport } from "./[externalTenantId]/operations/exports/[exportId]/route";
import { GET as billingOverview } from "./[externalTenantId]/operations/billing/route";
import { GET as lifecycleOverview } from "./[externalTenantId]/operations/lifecycle/route";
import { POST as transitionLifecycle } from "./[externalTenantId]/operations/lifecycle/transitions/route";
import { PATCH as patchBilling, POST as postBilling } from "./[externalTenantId]/operations/billing/[resource]/route";
import { POST as recordBillingDocument } from "./[externalTenantId]/operations/billing/documents/events/route";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSameOrigin).mockReturnValue(true);
});

describe("tenant operation BFF routes", () => {
  const tenant = "tenant_test";
  const sessionId = "00000000-0000-4000-8000-000000000111";

  it("loads the operator projection through the authenticated proxy", async () => {
    await overview(new Request(`http://wodana.test/api/internal/tenants/${tenant}/operations`), {
      params: Promise.resolve({ externalTenantId: tenant }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations`,
      { method: "GET" },
      expect.any(String),
    );
  });

  it("loads billing and accepts only the explicit same-origin billing commands", async () => {
    await billingOverview(new Request(`http://wodana.test/api/internal/tenants/${tenant}/operations/billing`), {
      params: Promise.resolve({ externalTenantId: tenant }),
    });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/billing`, { method: "GET" }, expect.any(String),
    );

    const body = JSON.stringify({ expectedVersion: 1 });
    await patchBilling(new Request("http://wodana.test/billing/contract", { method: "PATCH", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "contract" }),
    });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/billing/contract`,
      expect.objectContaining({ method: "PATCH", body }), expect.any(String),
    );
    await postBilling(new Request("http://wodana.test/billing/usage-snapshots", { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "usage-snapshots" }),
    });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/billing/usage-snapshots`,
      expect.objectContaining({ method: "POST", body }), expect.any(String),
    );
    expect((await patchBilling(new Request("http://wodana.test/billing/usage-snapshots", { method: "PATCH", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "usage-snapshots" }),
    })).status).toBe(400);
  });

  it("loads lifecycle and forwards only same-origin, keyed decisions", async () => {
    await lifecycleOverview(new Request(`http://wodana.test/api/internal/tenants/${tenant}/operations/lifecycle`), {
      params: Promise.resolve({ externalTenantId: tenant }),
    });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/lifecycle`, { method: "GET" }, expect.any(String),
    );
    const url = `http://wodana.test/api/internal/tenants/${tenant}/operations/lifecycle/transitions`;
    const body = JSON.stringify({ expectedVersion: 1, to: "suspended", reason: "Customer-approved access pause" });
    expect((await transitionLifecycle(new Request(url, { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    })).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await transitionLifecycle(new Request(url, { method: "POST", body, headers: { "idempotency-key": "pause-1" } }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    })).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(true);
    await transitionLifecycle(new Request(url, { method: "POST", body, headers: { "idempotency-key": "pause-1" } }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/lifecycle/transitions`,
      expect.objectContaining({ method: "POST", body,
        headers: expect.objectContaining({ "idempotency-key": "pause-1" }) }), expect.any(String),
    );
  });

  it("requires a bounded idempotency key for billing document events", async () => {
    const body = JSON.stringify({ documentType: "invoice", status: "issued" });
    expect((await recordBillingDocument(new Request("http://wodana.test/billing/documents", { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    })).status).toBe(400);
    await recordBillingDocument(new Request("http://wodana.test/billing/documents", {
      method: "POST", body, headers: { "idempotency-key": "invoice-event-1" },
    }), { params: Promise.resolve({ externalTenantId: tenant }) });
    expect(internalJsonResponse).toHaveBeenLastCalledWith(
      `/internal/operator/tenants/${tenant}/operations/billing/documents/events`,
      expect.objectContaining({ method: "POST", body,
        headers: expect.objectContaining({ "idempotency-key": "invoice-event-1" }) }),
      expect.any(String),
    );
  });

  it("accepts only known same-origin policy resources", async () => {
    const url = `http://wodana.test/api/internal/tenants/${tenant}/operations/entitlements`;
    const body = JSON.stringify({ expectedVersion: 0 });
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await updateResource(new Request(url, { method: "PATCH", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "entitlements" }),
    })).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(true);
    expect((await updateResource(new Request(url, { method: "PATCH", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "unknown" }),
    })).status).toBe(400);
    await updateResource(new Request(url, { method: "PATCH", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "entitlements" }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/entitlements`,
      expect.objectContaining({ method: "PATCH", body }),
      expect.any(String),
    );
  });

  it("proxies support requests and validates decisions", async () => {
    const supportBody = JSON.stringify({ accessLevel: "read_only", durationMinutes: 60, reason: "Investigate a reported access issue" });
    await requestSupport(new Request(`http://wodana.test/api/internal/tenants/${tenant}/operations/support-sessions`, {
      method: "POST", body: supportBody,
    }), { params: Promise.resolve({ externalTenantId: tenant }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/support-sessions`,
      expect.objectContaining({ method: "POST", body: supportBody }),
      expect.any(String),
    );

    const decisionBody = JSON.stringify({ expectedVersion: 1, decision: "approve", reason: "Reviewed by a second operator" });
    expect((await decideSupport(new Request("http://wodana.test/invalid", { method: "POST", body: decisionBody }), {
      params: Promise.resolve({ externalTenantId: tenant, sessionId: "not-a-uuid" }),
    })).status).toBe(400);
    await decideSupport(new Request("http://wodana.test/valid", { method: "POST", body: decisionBody }), {
      params: Promise.resolve({ externalTenantId: tenant, sessionId }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/support-sessions/${sessionId}/decision`,
      expect.objectContaining({ method: "POST", body: decisionBody }),
      expect.any(String),
    );
  });

  it("requires a bounded idempotency key for a dry-run plan", async () => {
    const url = `http://wodana.test/api/internal/tenants/${tenant}/operations/plans`;
    const body = JSON.stringify({ operationType: "export", reason: "Prepare a verified tenant export" });
    expect((await planOperation(new Request(url, { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    })).status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();

    await planOperation(new Request(url, { method: "POST", body, headers: { "idempotency-key": "tenant-export-1" } }), {
      params: Promise.resolve({ externalTenantId: tenant }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/plans`,
      expect.objectContaining({
        method: "POST",
        body,
        headers: expect.objectContaining({ "idempotency-key": "tenant-export-1" }),
      }),
      expect.any(String),
    );
  });

  it("validates and proxies a second-operator clone decision", async () => {
    const operationId = "00000000-0000-4000-8000-000000000222";
    const body = JSON.stringify({ expectedVersion: 1, decision: "approve", reason: "Reviewed the dry run and target state" });
    expect((await decideOperation(new Request("http://wodana.test/invalid", { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: "invalid" }),
    })).status).toBe(400);
    await decideOperation(new Request("http://wodana.test/valid", { method: "POST", body }), {
      params: Promise.resolve({ externalTenantId: tenant, resource: operationId }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/${operationId}/decision`,
      expect.objectContaining({ method: "POST", body }),
      expect.any(String),
    );
  });

  it("validates and proxies a verified tenant export download", async () => {
    const exportId = "00000000-0000-4000-8000-000000000444";
    expect((await downloadExport(new Request("http://wodana.test/invalid"), {
      params: Promise.resolve({ externalTenantId: tenant, exportId: "invalid" }),
    })).status).toBe(400);
    await downloadExport(new Request("http://wodana.test/valid"), {
      params: Promise.resolve({ externalTenantId: tenant, exportId }),
    });
    expect(internalBinaryResponse).toHaveBeenCalledWith(
      `/internal/operator/tenants/${tenant}/operations/exports/${exportId}/content`,
      "The tenant export could not be downloaded.",
    );
  });
});
