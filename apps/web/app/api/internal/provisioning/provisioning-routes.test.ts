import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal/proxy", () => ({ internalJsonResponse: vi.fn(async () => Response.json({ ok: true })) }));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
}));

import { internalJsonResponse } from "@/lib/internal/proxy";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { POST as createDraft } from "./drafts/route";
import { POST as provisionDraft } from "./drafts/[draftId]/provision/route";
import { POST as sendOwnerInvitation } from "../tenants/[externalTenantId]/owner-invitation/send/route";

afterEach(() => { vi.clearAllMocks(); vi.mocked(isSameOrigin).mockReturnValue(true); });

describe("operator provisioning BFF routes", () => {
  it("rejects a cross-origin draft before proxying", async () => {
    vi.mocked(isSameOrigin).mockReturnValue(false);
    const response = await createDraft(new Request("http://wodana.test/api/internal/provisioning/drafts", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();
  });

  it("forwards the draft and provision keys to operator-only routes", async () => {
    await createDraft(new Request("http://wodana.test/api/internal/provisioning/drafts", {
      method: "POST", headers: { "idempotency-key": "draft-key" }, body: JSON.stringify({ account: { displayName: "Test" } }),
    }));
    expect(internalJsonResponse).toHaveBeenCalledWith("/internal/operator/tenant-drafts", expect.objectContaining({
      headers: expect.objectContaining({ "idempotency-key": "draft-key" }),
    }), expect.any(String));
    const draftId = "00000000-0000-4000-8000-000000000111";
    await provisionDraft(new Request(`http://wodana.test/api/internal/provisioning/drafts/${draftId}/provision`, {
      method: "POST", headers: { "idempotency-key": "provision-key" }, body: JSON.stringify({ expectedVersion: 1 }),
    }), { params: Promise.resolve({ draftId }) });
    expect(internalJsonResponse).toHaveBeenCalledWith(`/internal/operator/tenant-drafts/${draftId}/provision`, expect.objectContaining({
      headers: expect.objectContaining({ "idempotency-key": "provision-key" }), body: JSON.stringify({ expectedVersion: 1 }),
    }), expect.any(String));
  });

  it("requires an explicit invitation key and forwards only the validated tenant ID", async () => {
    const request = (key?: string) => new Request("http://wodana.test/api/internal/tenants/tenant_test/owner-invitation/send", {
      method: "POST", headers: key ? { "idempotency-key": key } : undefined,
    });
    expect((await sendOwnerInvitation(request(), { params: Promise.resolve({ externalTenantId: "tenant_test" }) })).status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();
    await sendOwnerInvitation(request("send-key"), { params: Promise.resolve({ externalTenantId: "tenant_test" }) });
    expect(internalJsonResponse).toHaveBeenCalledWith("/internal/operator/tenants/tenant_test/owner-invitation/send", expect.objectContaining({
      headers: { "idempotency-key": "send-key" },
    }), expect.any(String));
  });
});
