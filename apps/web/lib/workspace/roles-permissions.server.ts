import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { WorkspaceMember, WorkspaceRole } from "./members";
import {
  rolesPermissionsFixture,
  type RolesPermissionsPageData,
  type WorkspacePermissionDefinition,
} from "./roles-permissions";

const INITIAL_PERMISSION_PREFIXES = ["module."];

export async function getRolesPermissionsPageData(): Promise<RolesPermissionsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  const canManage = membership.roles.some((role) =>
    ["owner", "administrator"].includes(role.toLowerCase()),
  );
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return rolesPermissionsFixture;
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [rolesResponse, permissionsResponse, membersResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}/roles`),
    request("/reference/permissions"),
    request(`/workspaces/${membership.workspaceId}/members`),
  ]);

  if ([rolesResponse, permissionsResponse, membersResponse].some((response) => response?.status === 401)) {
    redirect("/login");
  }
  if (!rolesResponse || !permissionsResponse || !membersResponse) {
    throw new Error("The roles and permissions service is unavailable.");
  }
  if (!rolesResponse.ok || !permissionsResponse.ok || !membersResponse.ok) {
    throw new Error("Roles and permissions could not be loaded.");
  }

  const permissions = await permissionsResponse.json() as WorkspacePermissionDefinition[];
  const members = await membersResponse.json() as WorkspaceMember[];
  return {
    canManage,
    memberCount: members.length,
    permissions: permissions.filter((permission) =>
      INITIAL_PERMISSION_PREFIXES.some((prefix) => permission.code.startsWith(prefix)),
    ),
    roles: await rolesResponse.json() as WorkspaceRole[],
    workspaceId: membership.workspaceId,
  };
}
