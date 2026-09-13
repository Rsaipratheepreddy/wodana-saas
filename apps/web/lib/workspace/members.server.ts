import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import {
  membersPageFixture,
  type MembersPageData,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceRole,
} from "./members";

export async function getMembersPageData(): Promise<MembersPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  const canManage = membership.roles.some((role) =>
    ["owner", "administrator"].includes(role.toLowerCase()),
  );

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return membersPageFixture;
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);

  const [membersResponse, rolesResponse, invitationsResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}/members`),
    request(`/workspaces/${membership.workspaceId}/roles`),
    canManage ? request(`/workspaces/${membership.workspaceId}/invitations`) : Promise.resolve(null),
  ]);

  if ([membersResponse, rolesResponse, invitationsResponse].some((response) => response?.status === 401)) {
    redirect("/login");
  }
  if (!membersResponse || !rolesResponse || (canManage && !invitationsResponse)) {
    throw new Error("The members service is unavailable.");
  }
  if (!membersResponse.ok || !rolesResponse.ok || (invitationsResponse && !invitationsResponse.ok)) {
    throw new Error("Workspace members could not be loaded.");
  }

  return {
    canManage,
    currentUserId: authProfile.id,
    currentUserName: authProfile.displayName,
    workspaceId: membership.workspaceId,
    members: await membersResponse.json() as WorkspaceMember[],
    roles: await rolesResponse.json() as WorkspaceRole[],
    invitations: invitationsResponse
      ? await invitationsResponse.json() as WorkspaceInvitation[]
      : [],
  };
}
