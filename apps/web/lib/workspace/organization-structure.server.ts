import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { CompanyProfileData } from "./company-profile";
import type { WorkspaceMember } from "./members";
import type { WorkspaceRole } from "./members";
import {
  organizationStructureFixture,
  type OrganizationStructurePageData,
  type TeamQueueOption,
  type WorkspaceTeamRecord,
} from "./organization-structure";

export async function getOrganizationStructurePageData(): Promise<OrganizationStructurePageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");
  const canManage = membership.roles.some((role) =>
    ["owner", "administrator"].includes(role.toLowerCase()),
  );
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return organizationStructureFixture;
  }
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [profileResponse, teamsResponse, membersResponse, rolesResponse, queuesResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    request(`/workspaces/${membership.workspaceId}/teams`),
    request(`/workspaces/${membership.workspaceId}/members`),
    canManage ? request(`/workspaces/${membership.workspaceId}/roles`) : Promise.resolve(null),
    canManage ? request(`/workspaces/${membership.workspaceId}/crm/queues`) : Promise.resolve(null),
  ]);
  if ([profileResponse, teamsResponse, membersResponse, rolesResponse, queuesResponse].some((response) => response?.status === 401)) {
    redirect("/login");
  }
  if (!profileResponse || !teamsResponse || !membersResponse || (canManage && (!rolesResponse || !queuesResponse))) {
    throw new Error("The organization structure service is unavailable.");
  }
  if (!profileResponse.ok || !teamsResponse.ok || !membersResponse.ok || (rolesResponse && !rolesResponse.ok) || (queuesResponse && !queuesResponse.ok)) {
    throw new Error("The organization structure could not be loaded.");
  }
  const profile = await profileResponse.json() as CompanyProfileData;
  return {
    canManage,
    workspaceId: membership.workspaceId,
    legalEntities: profile.legalEntities,
    businessUnits: profile.businessUnits,
    teams: await teamsResponse.json() as WorkspaceTeamRecord[],
    members: await membersResponse.json() as WorkspaceMember[],
    roles: rolesResponse ? await rolesResponse.json() as WorkspaceRole[] : [],
    queues: queuesResponse ? await queuesResponse.json() as TeamQueueOption[] : [],
  };
}
