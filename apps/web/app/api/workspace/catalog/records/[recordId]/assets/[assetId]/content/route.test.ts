import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/backend-session", () => ({
  authenticatedBackendFetch: vi.fn(),
  applyRotatedSession: vi.fn(),
}));

import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { GET } from "./route";

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";
const recordId = "4704511c-e908-4fc1-a59c-1f10be292c1d";
const assetId = "53112204-8cd9-44a8-83f8-32df10686d72";

describe("catalog image gateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an authenticated preview without exposing backend storage", async () => {
    vi.mocked(authenticatedBackendFetch).mockResolvedValue({
      unauthenticated: false,
      upstream: new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } }),
    });
    const response = await GET(
      new Request(`http://localhost/api/workspace/catalog/records/${recordId}/assets/${assetId}/content?workspaceId=${workspaceId}&preview=1`),
      { params: Promise.resolve({ recordId, assetId }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(authenticatedBackendFetch).toHaveBeenCalledWith(
      `/workspaces/${workspaceId}/catalog/records/${recordId}/assets/${assetId}/content?preview=1`,
      { method: "GET" },
    );
  });

  it("rejects malformed identifiers before calling the backend", async () => {
    const response = await GET(
      new Request(`http://localhost/api/workspace/catalog/records/nope/assets/${assetId}/content?workspaceId=${workspaceId}`),
      { params: Promise.resolve({ recordId: "nope", assetId }) },
    );
    expect(response.status).toBe(400);
    expect(authenticatedBackendFetch).not.toHaveBeenCalled();
  });
});
