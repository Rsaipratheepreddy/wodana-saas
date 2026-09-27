import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";

vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }),
  workspaceJsonResponse: vi.fn(),
}));

import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { PATCH } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";

function request(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/workspace/members/${membershipId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace member access BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ id: membershipId }));
  });

  it("forwards removal of all direct roles for backend validation against inherited team access", async () => {
    const response = await PATCH(
      request({ workspaceId, version: 7, status: "active", roleCodes: [] }),
      { params: Promise.resolve({ membershipId }) },
    );

    expect(response.status).toBe(200);
    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/members/${membershipId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ version: 7, status: "active", roleCodes: [] }),
      }),
      "The member could not be updated.",
    );
  });

  it("rejects duplicate, malformed, or excessive role codes before the upstream call", async () => {
    const invalidRoleSets: unknown[][] = [["member", "member"], ["not a role"], Array.from({ length: 21 }, (_, index) => `role-${index}`)];
    for (const roleCodes of invalidRoleSets) {
      vi.clearAllMocks();
      const response = await PATCH(
        request({ workspaceId, version: 7, roleCodes }),
        { params: Promise.resolve({ membershipId }) },
      );
      expect(response.status).toBe(400);
      expect(workspaceJsonResponse).not.toHaveBeenCalled();
    }
  });
});
