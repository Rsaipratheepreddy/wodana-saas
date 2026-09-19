import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { CompanyProfileData } from "./company-profile";
import { integrationsPageFixture, providerCapabilitiesFixture, type IntegrationConnection, type IntegrationsPageData, type ProviderCapabilitiesResponse } from "./integrations";

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
  const [profileResponse, connectionsResponse, capabilitiesResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    request(`/workspaces/${membership.workspaceId}/integration-connections`),
    request(`/workspaces/${membership.workspaceId}/integration-capabilities`),
  ]);
  if ([profileResponse, connectionsResponse, capabilitiesResponse].some((response) => response?.status === 401)) redirect("/login");
  if (!profileResponse?.ok) throw new Error("The workspace profile could not be loaded.");

  const profile = await profileResponse.json() as CompanyProfileData;
  return {
    canManage,
    // Integrations are an optional capability on older core releases. Keep the
    // settings screen usable and show the provider catalogue while that API is
    // unavailable instead of failing the entire workspace settings route.
    connections: connectionsResponse?.ok
      ? await connectionsResponse.json() as IntegrationConnection[]
      : [],
    legalEntities: profile.legalEntities,
    providerCapabilities: capabilitiesResponse?.ok
      ? await capabilitiesResponse.json() as ProviderCapabilitiesResponse
      : providerCapabilitiesFixture,
    workspaceId: membership.workspaceId,
  };
}
