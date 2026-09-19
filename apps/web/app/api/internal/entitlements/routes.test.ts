import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal/proxy", () => ({
  internalJsonResponse: vi.fn(async () => Response.json({ ok: true })),
}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  isSameOrigin: vi.fn(() => true),
}));

import { internalJsonResponse } from "@/lib/internal/proxy";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { GET as catalog } from "./catalog/route";
import { PATCH as updateCapability } from "./capabilities/route";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSameOrigin).mockReturnValue(true);
});

describe("entitlement catalogue BFF", () => {
  it("loads the authenticated platform catalogue", async () => {
    await catalog();
    expect(internalJsonResponse).toHaveBeenCalledWith(
      "/internal/operator/tenants/platform/entitlement-catalog",
      { method: "GET" },
      expect.any(String),
    );
  });

  it("requires same-origin capability writes", async () => {
    const request = new Request("http://wodana.test/api/internal/entitlements/capabilities", {
      method: "PATCH", body: JSON.stringify({ code: "crm.ai_reply" }),
    });
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await updateCapability(request)).status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();
  });
});
