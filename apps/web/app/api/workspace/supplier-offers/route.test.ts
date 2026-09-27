import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
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

describe("supplier-offer gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ data: [] }));
  });

  it("proxies only bounded comparison filters", async () => {
    await GET(new Request(`http://localhost/api/workspace/supplier-offers?workspaceId=${workspaceId}&status=active&search=oak`));
    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/supplier-offers?limit=100&status=active&search=oak`,
      { method: "GET" },
      expect.any(String),
    );
  });

  it("rejects unknown status and oversized search", async () => {
    expect((await GET(new Request(`http://localhost/api/workspace/supplier-offers?workspaceId=${workspaceId}&status=live`))).status).toBe(400);
    expect((await GET(new Request(`http://localhost/api/workspace/supplier-offers?workspaceId=${workspaceId}&search=${"a".repeat(241)}`))).status).toBe(400);
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });
});
