import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  isSameOrigin: vi.fn(), workspaceJsonResponse: vi.fn(),
}));

import { isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";
const caseId = "123e4567-e89b-42d3-a456-426614174000";
const path = ["cases", caseId, "catalog-price"];

describe("commercial selling-price gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSameOrigin).mockReturnValue(true);
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it("proxies a same-origin catalogue price check for the selected case", async () => {
    const body = { catalogId: "catalog", workId: "work", workVersion: 2, quantity: 1, unitLabel: "nos", currency: "AED", taxRate: 5 };
    await POST(new Request(`http://localhost/api/commercial/cases/${caseId}/catalog-price?workspaceId=${workspaceId}`, { method: "POST", body: JSON.stringify(body), headers: { origin: "http://localhost" } }), { params: Promise.resolve({ path }) });
    expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${workspaceId}/commercial/cases/${caseId}/catalog-price`, expect.objectContaining({ method: "POST", body: JSON.stringify(body) }), expect.any(String));
  });

  it("rejects cross-origin and unknown commercial commands", async () => {
    vi.mocked(isSameOrigin).mockReturnValue(false);
    const crossOrigin = await POST(new Request(`http://localhost/api/commercial/cases/${caseId}/catalog-price?workspaceId=${workspaceId}`, { method: "POST" }), { params: Promise.resolve({ path }) });
    expect(crossOrigin.status).toBe(403);
    const unknown = await POST(new Request(`http://localhost/api/commercial/cases/${caseId}/unknown?workspaceId=${workspaceId}`, { method: "POST" }), { params: Promise.resolve({ path: ["cases", caseId, "unknown"] }) });
    expect(unknown.status).toBe(400);
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });
});
