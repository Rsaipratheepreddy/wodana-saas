import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("workspace onboarding gate", () => {
  it.each(["start_onboarding", "resume_onboarding"])("redirects %s sessions to onboarding", async (nextAction) => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nextAction }),
      status: 200,
    }));
    const request = new NextRequest("http://localhost/workspace/crm", {
      headers: { cookie: "wodana_access=access-token" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/onboarding");
  });

  it("allows completed onboarding into the workspace", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nextAction: "enter_workspace" }),
      status: 200,
    }));
    const request = new NextRequest("http://localhost/workspace", {
      headers: { cookie: "wodana_access=access-token" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
