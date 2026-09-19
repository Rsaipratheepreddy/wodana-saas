import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  invalidRequest: vi.fn((message: string) => NextResponse.json({ message }, { status: 400 })),
  workspaceJsonResponse: vi.fn(),
}));

import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { GET } from "./route";

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";

describe("workspace search gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ items: [] }));
  });

  it("proxies a bounded query to the permission-filtered workspace endpoint", async () => {
    const response = await GET(new Request(`http://localhost/api/workspace/search?workspaceId=${workspaceId}&q=villa&limit=20`));
    expect(response.status).toBe(200);
    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/search?q=villa&limit=20`,
      { method: "GET" },
      "Workspace search could not be loaded.",
    );
  });

  it.each([
    [`workspaceId=bad&q=villa`, "workspace"],
    [`workspaceId=${workspaceId}&q=a`, "characters"],
    [`workspaceId=${workspaceId}&q=villa&limit=99`, "limit"],
  ])("rejects an invalid request before contacting the backend: %s", async (query, message) => {
    const response = await GET(new Request(`http://localhost/api/workspace/search?${query}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ message: expect.stringMatching(new RegExp(message, "i")) }));
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });
});
