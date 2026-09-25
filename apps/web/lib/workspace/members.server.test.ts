import { afterEach, describe, expect, it, vi } from "vitest";

const memberGrant = vi.hoisted(() => ({ permissions: ["module.roles.read"] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-token" }) }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/auth/server", () => ({
  ACCESS_COOKIE: "access",
  businessApiUrl: (path: string) => path,
  getAuthenticatedProfile: async () => ({
    id: "user-1",
    displayName: "Role viewer",
    memberships: [{ workspaceId: "workspace", roles: ["role_viewer"], allowedPermissions: memberGrant.permissions }],
  }),
}));

import { getMembersPageData } from "./members.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  memberGrant.permissions = ["module.roles.read"];
});

describe("People page data", () => {
  it("shows a truthful denied state without fetching the People directory", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMembersPageData();

    expect(result).toMatchObject({ canView: false, members: [], roles: [], invitations: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the directory and invitations for a scoped inviter without requiring Teams read", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    memberGrant.permissions = ["module.members.write"];
    const fetchMock = vi.fn(async (path: string) => new Response(path.endsWith("/roles")
      ? JSON.stringify([{ id: "role-1", code: "people_inviter", permissions: ["module.members.write"] }])
      : "[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMembersPageData();

    expect(result).toMatchObject({ canView: true, canInvite: true, canEdit: false, teams: [] });
    expect(result.assignableRoleCodes).toEqual(["people_inviter"]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/workspaces/workspace/members",
      "/workspaces/workspace/roles",
      "/workspaces/workspace/invitations",
    ]);
  });
});
