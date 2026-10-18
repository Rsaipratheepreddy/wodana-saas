import { afterEach, describe, expect, it, vi } from "vitest";

const memberGrant = vi.hoisted(() => ({ permissions: ["module.roles.read"] as string[], roles: ["role_viewer"] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-token" }) }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/auth/server", () => ({
  ACCESS_COOKIE: "access",
  businessApiUrl: (path: string) => path,
  getAuthenticatedProfile: async () => ({
    id: "user-1",
    displayName: "Role viewer",
    memberships: [{ workspaceId: "workspace", roles: memberGrant.roles, allowedPermissions: memberGrant.permissions }],
  }),
}));

import { getMembersPageData } from "./members.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  memberGrant.permissions = ["module.roles.read"];
  memberGrant.roles = ["role_viewer"];
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
      "/workspaces/workspace/seats",
    ]);
  });

  it("offers View as only to the owner, with their MFA state and the notice setting", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "false");
    memberGrant.permissions = ["workspace.members.manage", "workspace.view_as"];
    memberGrant.roles = ["administrator"];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect((await getMembersPageData()).viewAs).toMatchObject({ canViewAs: false });
    memberGrant.roles = ["owner"];
    const fetchMock = vi.fn(async (path: string) => new Response(path.startsWith("/security/mfa/status")
      ? JSON.stringify({ enabled: true })
      : path.endsWith("/view-as/settings") ? JSON.stringify({ notifySubject: false, version: 2 }) : "[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMembersPageData();

    expect(result.viewAs).toEqual({ canViewAs: true, mfaEnabled: true, settings: { notifySubject: false, version: 2 }, viewerIsOwner: true });
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain("/security/mfa/status?workspaceId=workspace");
  });
});
