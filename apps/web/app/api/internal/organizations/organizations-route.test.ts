import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal/proxy", () => ({ internalJsonResponse: vi.fn(async () => Response.json({ ok: true })) }));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
}));

import { internalJsonResponse } from "@/lib/internal/proxy";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { GET, PATCH, POST } from "./[key]/[...path]/route";

const session = "44444444-4444-4444-8444-444444444444";
const context = (key: string, path: string[]) => ({ params: Promise.resolve({ key, path }) });
const request = (method: string, headers: Record<string, string> = {}) =>
  new Request("http://wodana.test/api/internal/organizations/x", { method, headers, ...(method === "GET" ? {} : { body: "{}" }) });

describe("organization console routes", () => {
  afterEach(() => { vi.mocked(internalJsonResponse).mockClear(); vi.mocked(isSameOrigin).mockReturnValue(true); });

  it("forwards only the known routes of one organization", async () => {
    await GET(request("GET"), context("tenant_acme", ["support", "members"]));
    expect(internalJsonResponse).toHaveBeenLastCalledWith("/internal/operator/organizations/tenant_acme/support/members",
      expect.objectContaining({ method: "GET" }), expect.any(String));
    expect((await GET(request("GET"), context("tenant_acme", ["support", "export-everything"]))).status).toBe(400);
    expect((await POST(request("POST"), context("../other", ["seats"]))).status).toBe(400);
    await POST(request("POST"), context("tenant_acme", ["support-sessions", session, "approve"]));
    expect(internalJsonResponse).toHaveBeenLastCalledWith(`/internal/operator/organizations/tenant_acme/support-sessions/${session}/approve`,
      expect.objectContaining({ method: "POST", body: "{}" }), expect.any(String));
    await PATCH(request("PATCH"), context("tenant_acme", ["seats"]));
    expect(internalJsonResponse).toHaveBeenCalledTimes(3);
  });

  it("requires an idempotency key for state changes and support requests, and the same origin for every change", async () => {
    expect((await POST(request("POST"), context("tenant_acme", ["lifecycle", "transitions"]))).status).toBe(400);
    await POST(request("POST", { "idempotency-key": "suspend-1" }), context("tenant_acme", ["lifecycle", "transitions"]));
    expect(internalJsonResponse).toHaveBeenLastCalledWith("/internal/operator/organizations/tenant_acme/lifecycle/transitions",
      expect.objectContaining({ headers: expect.objectContaining({ "idempotency-key": "suspend-1" }) }), expect.any(String));
    expect((await POST(request("POST"), context("tenant_acme", ["support-sessions"]))).status).toBe(400);
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await PATCH(request("PATCH"), context("tenant_acme", ["seats"]))).status).toBe(400);
  });
});
