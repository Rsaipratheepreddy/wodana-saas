import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  invalidRequest: vi.fn((message: string) => NextResponse.json({ message }, { status: 400 })),
  isSameOrigin: vi.fn(),
  workspaceJsonResponse: vi.fn(),
}));

import { isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";

describe("catalogue assembly preview gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSameOrigin).mockReturnValue(true);
    vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it("proxies the bounded same-origin preview command", async () => {
    const body = { templateId: "template", executionId: "execution" };
    await POST(
      new Request(`http://localhost/api/workspace/catalog/preview?workspaceId=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ path: ["preview"] }) },
    );
    expect(workspaceJsonResponse).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/catalog/preview`,
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
      expect.any(String),
    );
  });

  it("rejects an unknown catalogue command", async () => {
    const response = await POST(
      new Request(`http://localhost/api/workspace/catalog/unknown?workspaceId=${workspaceId}`, { method: "POST" }),
      { params: Promise.resolve({ path: ["unknown"] }) },
    );
    expect(response.status).toBe(400);
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
  });
});
