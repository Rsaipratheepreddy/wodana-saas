import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { WorkspaceMember, WorkspaceRole } from "./members";
import {
  rolesPermissionsFixture,
  roleMutationCapabilities,
  type RolesPermissionsPageData,
  type WorkspacePermissionDefinition,
} from "./roles-permissions";
import { getViewAsReadiness } from "./view-as.server";

export async function getRolesPermissionsPageData(): Promise<RolesPermissionsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  const capabilities = roleMutationCapabilities(membership.allowedPermissions, membership.roles);
  const canDelegateAll = membership.allowedPermissions?.includes("workspace.roles.manage")
    ?? membership.roles.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  const canReadMembers = membership.allowedPermissions
    ? membership.allowedPermissions.some((permission) => ["module.members.read", "workspace.members.manage"].includes(permission))
    : membership.roles.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
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
    canReadMembers ? request(`/workspaces/${membership.workspaceId}/members`) : Promise.resolve(null),
  ]);

  if ([rolesResponse, permissionsResponse, membersResponse].some((response) => response?.status === 401)) {
    redirect("/login");
  }
  if (!rolesResponse || !permissionsResponse || (canReadMembers && !membersResponse)) {
    throw new Error("The roles and permissions service is unavailable.");
  }
  if (!rolesResponse.ok || !permissionsResponse.ok || (membersResponse && !membersResponse.ok)) {
    throw new Error("Roles and permissions could not be loaded.");
  }

  const permissions = await permissionsResponse.json() as WorkspacePermissionDefinition[];
  const members = membersResponse ? await membersResponse.json() as WorkspaceMember[] : null;
  const viewAs = await getViewAsReadiness(authProfile);
  const canEditMembers = membership.allowedPermissions
    ? membership.allowedPermissions.some((permission) => ["module.members.edit", "workspace.members.manage"].includes(permission))
    : membership.roles.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  return {
    ...capabilities,
    canEditMembers,
    viewAs: { canViewAs: viewAs.canViewAs, mfaEnabled: viewAs.mfaEnabled, viewerIsOwner: membership.roles.includes("owner") },
    delegablePermissions: canDelegateAll ? null : membership.allowedPermissions ?? [],
    memberCount: members?.length ?? null,
    members: members?.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      email: member.email,
      avatarPreset: member.avatarPreset ?? null,
      photoUrl: member.photoUrl ?? null,
      roles: [...member.roles, ...(member.inheritedRoles ?? [])],
      directRoles: member.roles,
      version: member.version,
    })) ?? null,
    permissions,
    roles: await rolesResponse.json() as WorkspaceRole[],
    workspaceId: membership.workspaceId,
  };
}
