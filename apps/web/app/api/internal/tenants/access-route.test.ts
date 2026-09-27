import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });

vi.mock("@/lib/internal/proxy", () => ({ internalJsonResponse: vi.fn(async () => Response.json({ ok: true })) }));
vi.mock("@/lib/workspace/workspace-api", () => ({
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
}));

import { internalJsonResponse } from "@/lib/internal/proxy";
import { GET } from "./[externalTenantId]/access/route";

describe("operator tenant access BFF route", () => {
  it("proxies only a valid tenant identifier to the scoped backend route", async () => {
    const invalid = await GET(new Request("http://wodana.test/api/internal/tenants/bad/access"), {
      params: Promise.resolve({ externalTenantId: "bad/tenant" }),
    });
    expect(invalid.status).toBe(400);
    expect(internalJsonResponse).not.toHaveBeenCalled();

    await GET(new Request("http://wodana.test/api/internal/tenants/tenant_test/access"), {
      params: Promise.resolve({ externalTenantId: "tenant_test" }),
    });
    expect(internalJsonResponse).toHaveBeenCalledWith(
      "/internal/operator/tenants/tenant_test/access",
      { method: "GET" },
      "The tenant access explanation could not be loaded.",
    );
  });
});
