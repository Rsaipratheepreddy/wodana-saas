import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-token" }) }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/auth/server", () => ({
  ACCESS_COOKIE: "access",
  businessApiUrl: (path: string) => path,
  getAuthenticatedProfile: async () => ({
    memberships: [{ workspaceId: "workspace", roles: ["role_editor"], allowedPermissions: ["module.roles.edit"] }],
  }),
}));

import { getRolesPermissionsPageData } from "./roles-permissions.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("roles page data", () => {
  it("loads for a role editor without requiring the member directory", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    const fetchMock = vi.fn(async (path: string) => {
      if (!path) throw new Error("Expected a request path");
      return new Response("[]", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRolesPermissionsPageData();

    expect(result).toMatchObject({
      canCreate: false, canEdit: true, canDelete: false,
      delegablePermissions: ["module.roles.edit"], memberCount: null,
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/workspaces/workspace/roles",
      "/reference/permissions",
    ]);
  });
});
