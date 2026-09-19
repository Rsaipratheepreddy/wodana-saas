import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f-]{36}$/i,
  isSameOrigin: vi.fn(),
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  workspaceJsonResponse: vi.fn(),
}));

import { isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { GET, POST } from "./route";

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";
const partyId = "123e4567-e89b-42d3-a456-426614174000";
const mergeId = "123e4567-e89b-42d3-a456-426614174001";

function request(path: string, method = "GET", body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/workspace/crm/data/${path}?workspaceId=${workspaceId}`, {
    method,
    headers: { origin: "http://localhost", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("CRM data gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSameOrigin).mockReturnValue(true);
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it("proxies the signed-in user's notification inbox", async () => {
    await GET(request("notifications"), { params: Promise.resolve({ path: ["notifications"] }) });

    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/crm/notifications`,
      expect.objectContaining({ method: "GET" }),
      expect.any(String),
    );
  });

  it("permits deliberate customer merge and privacy actions", async () => {
    await POST(request("parties/merge", "POST", { primaryPartyId: partyId, duplicatePartyId: mergeId }), {
      params: Promise.resolve({ path: ["parties", "merge"] }),
    });
    await POST(request(`parties/${partyId}/privacy-erasure`, "POST", { version: 3, reason: "Requested by customer" }), {
      params: Promise.resolve({ path: ["parties", partyId, "privacy-erasure"] }),
    });

    expect(workspaceJsonResponse).toHaveBeenNthCalledWith(
      1,
      `/workspaces/${workspaceId}/crm/parties/merge`,
      expect.objectContaining({ method: "POST" }),
      expect.any(String),
    );
    expect(workspaceJsonResponse).toHaveBeenNthCalledWith(
      2,
      `/workspaces/${workspaceId}/crm/parties/${partyId}/privacy-erasure`,
      expect.objectContaining({ method: "POST" }),
      expect.any(String),
    );
  });

  it("keeps internal notification-worker controls out of the browser gateway", async () => {
    const response = await POST(request("notifications/claim", "POST", { limit: 10 }), {
      params: Promise.resolve({ path: ["notifications", "claim"] }),
    });

    expect(response.status).toBe(400);
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });
});
