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
      json: async () => ({ nextAction, memberships: [{ workspaceId: "workspace-1", workspaceSlug: "example", allowedModules: ["workspace", "crm"] }] }),
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
      json: async () => ({ nextAction: "enter_workspace", memberships: [{ workspaceId: "workspace-1", workspaceSlug: "example", allowedModules: ["workspace", "crm"] }] }),
      status: 200,
    }));
    const request = new NextRequest("http://localhost/workspace", {
      headers: { cookie: "wodana_access=access-token" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("uses the selected organization's onboarding and module grants", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ nextAction: "resume_onboarding", memberships: [
        { workspaceId: "one", workspaceSlug: "one", allowedModules: ["workspace", "crm"], onboarding: { status: "in_progress" } },
        { workspaceId: "two", workspaceSlug: "two", allowedModules: ["workspace", "hrms"], onboarding: { status: "completed" } },
      ] }),
    }));
    const allowed = await proxy(new NextRequest("http://localhost/workspace/hrms", {
      headers: { cookie: "wodana_access=access-token; wodana_workspace=two" },
    }));
    expect(allowed.status).toBe(200);
    const denied = await proxy(new NextRequest("http://localhost/workspace/crm/leads", {
      headers: { cookie: "wodana_access=access-token; wodana_workspace=two" },
    }));
    expect(denied.headers.get("location")).toBe("http://localhost/workspace-access-denied");
    const onboarding = await proxy(new NextRequest("http://localhost/workspace/crm", {
      headers: { cookie: "wodana_access=access-token; wodana_workspace=one" },
    }));
    expect(onboarding.headers.get("location")).toBe("http://localhost/onboarding");
  });

  it("does not open a workspace when all organizations are suspended", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ nextAction: "await_invitation", memberships: [], unavailableOrganizations: [{ workspaceId: "one", workspaceStatus: "suspended" }] }),
    }));
    const response = await proxy(new NextRequest("http://localhost/workspace", { headers: { cookie: "wodana_access=access-token" } }));
    expect(response.headers.get("location")).toBe("http://localhost/workspace-access-denied");
  });

  it("applies downgrade and restoration to direct links without trusting prior navigation state", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    let allowedModules = ["workspace", "crm", "projects"];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ nextAction: "enter_workspace", memberships: [{
        workspaceId: "workspace-1",
        workspaceSlug: "example",
        allowedModules,
        onboarding: { status: "completed" },
      }] }),
    })));
    const direct = () => proxy(new NextRequest("http://localhost/workspace/projects/project-1", {
      headers: { cookie: "wodana_access=access-token; wodana_workspace=workspace-1" },
    }));

    expect((await direct()).status).toBe(200);
    allowedModules = ["workspace", "crm"];
    expect((await direct()).headers.get("location")).toBe("http://localhost/workspace-access-denied");
    allowedModules = ["workspace", "crm", "projects"];
    expect((await direct()).status).toBe(200);
  });
});
