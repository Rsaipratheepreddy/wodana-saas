import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }),
  workspaceJsonResponse: vi.fn(),
}));

import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const teamId = "22222222-2222-4222-8222-222222222222";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/workspace/members/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace member invitation BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ id: "invitation" }));
  });

  it("forwards a team-only invitation without inventing a direct role", async () => {
    const response = await POST(request({
      workspaceId,
      displayName: "Cece Serna",
      email: "cece@palmlivingae.com",
      roleCodes: [],
      teamIds: [teamId],
    }));

    expect(response.status).toBe(200);
    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/invitations`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          displayName: "Cece Serna",
          email: "cece@palmlivingae.com",
          roleCodes: [],
          teamIds: [teamId],
        }),
      }),
      "The invitation could not be created.",
    );
  });

  it("accepts email-only invitations while preserving roles", async () => {
    const response = await POST(request({ workspaceId, email: " NEW@example.com ", roleCodes: ["member"] }));
    expect(response.status).toBe(200);
    const options = vi.mocked(workspaceJsonResponse).mock.calls[0][1];
    expect(JSON.parse(String(options.body))).toEqual({email:"new@example.com", roleCodes:["member"], teamIds:[]});
  });

  it("rejects malformed supplied names", async () => {
    for (const displayName of [null, 42, "", "x"]) {
      const response = await POST(request({ workspaceId, displayName, email:"new@example.com", roleCodes:["member"] }));
      expect(response.status).toBe(400);
    }
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });

  it("requires either a valid team or a direct role", async () => {
    const response = await POST(request({ workspaceId, displayName: "Cece Serna", email: "cece@palmlivingae.com", roleCodes: [], teamIds: [] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Choose at least one workspace team or direct role." });
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });

  it("rejects malformed or duplicate team identifiers before the upstream call", async () => {
    for (const teamIds of [["not-a-team"], [teamId, teamId]]) {
      vi.clearAllMocks();
      const response = await POST(request({ workspaceId, displayName: "Cece Serna", email: "cece@palmlivingae.com", roleCodes: [], teamIds }));
      expect(response.status).toBe(400);
      expect(workspaceJsonResponse).not.toHaveBeenCalled();
    }
  });
});
