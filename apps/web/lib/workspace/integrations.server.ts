import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { CompanyProfileData } from "./company-profile";
import { integrationsPageFixture, type IntegrationConnection, type IntegrationsPageData } from "./integrations";

export async function getIntegrationsPageData(): Promise<IntegrationsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");
  const canManage = membership.roles.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return integrationsPageFixture;

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [profileResponse, connectionsResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    request(`/workspaces/${membership.workspaceId}/integration-connections`),
  ]);
  if ([profileResponse, connectionsResponse].some((response) => response?.status === 401)) redirect("/login");
  if (!profileResponse || !connectionsResponse) throw new Error("The integrations service is unavailable.");
  if (!profileResponse.ok || !connectionsResponse.ok) throw new Error("Integrations could not be loaded.");

  const profile = await profileResponse.json() as CompanyProfileData;
  return {
    canManage,
    connections: await connectionsResponse.json() as IntegrationConnection[],
    legalEntities: profile.legalEntities,
    workspaceId: membership.workspaceId,
  };
}
