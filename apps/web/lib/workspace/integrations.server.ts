import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { CompanyProfileData } from "./company-profile";
import { integrationsPageFixture, type IntegrationConnection, type IntegrationsPageData, type ProviderCapabilitiesResponse } from "./integrations";

export async function getIntegrationsPageData(workspaceId?: string, strict = false): Promise<IntegrationsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = workspaceId ? authProfile.memberships.find(item=>item.workspaceId===workspaceId) : authProfile.memberships[0];
  if (!membership) redirect("/login");
  const canManage = membership.roles.some((role) => ["owner", "administrator"].includes(role.toLowerCase()));
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return integrationsPageFixture;

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [profileResponse, connectionsResponse, capabilitiesResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    request(`/workspaces/${membership.workspaceId}/integration-connections`),
    request(`/workspaces/${membership.workspaceId}/integration-capabilities`),
  ]);
  if ([profileResponse, connectionsResponse, capabilitiesResponse].some((response) => response?.status === 401)) redirect("/login");
  if (!profileResponse?.ok) throw new Error("The workspace profile could not be loaded.");

  if (strict && (!connectionsResponse?.ok || !capabilitiesResponse?.ok)) throw new Error("Accounting connection status could not be loaded.");
  const profile = await profileResponse.json() as CompanyProfileData;
  return {
    canManage: canManage && Boolean(connectionsResponse?.ok && capabilitiesResponse?.ok),
    loadError: connectionsResponse?.ok && capabilitiesResponse?.ok ? undefined : "Connection status is unavailable. Reload before making changes.",
    connections: connectionsResponse?.ok
      ? await connectionsResponse.json() as IntegrationConnection[]
      : [],
    legalEntities: profile.legalEntities,
    providerCapabilities: capabilitiesResponse?.ok
      ? await capabilitiesResponse.json() as ProviderCapabilitiesResponse
      : { generatedAt: new Date().toISOString(), providers: [] },
    workspaceId: membership.workspaceId,
  };
}
