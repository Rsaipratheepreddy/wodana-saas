import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile, intelligenceApiUrl } from "@/lib/auth/server";
import type { CompanyProfileData } from "./company-profile";
import { MANAGE_CONNECTIONS, meetsRule } from "./access";
import { integrationsPageFixture, type IntegrationConnection, type IntegrationProvider, type IntegrationsPageData, type ProviderCapabilitiesResponse } from "./integrations";

const READINESS_PROVIDERS: IntegrationProvider[] = ["google_workspace", "quickbooks", "zoho_books", "whatsapp"];

/** Which providers firms can connect now: Wodana's own app for each is set up (from Wodana Control, read live). */
async function platformReadiness(): Promise<IntegrationsPageData["platformReadiness"]> {
  const response = await fetch(intelligenceApiUrl("/integrations/providers/readiness"), {
    cache: "no-store", signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return undefined;
  return Object.fromEntries(READINESS_PROVIDERS.filter((provider) => typeof payload[provider] === "boolean")
    .map((provider) => [provider, payload[provider] as boolean]));
}

export async function getIntegrationsPageData(workspaceId?: string, strict = false): Promise<IntegrationsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = workspaceId ? authProfile.memberships.find(item=>item.workspaceId===workspaceId) : authProfile.memberships[0];
  if (!membership) redirect("/login");
  // Owners and administrators, and any role given the connection permissions (what Business Core checks).
  const canManage = meetsRule(MANAGE_CONNECTIONS, { permissions: membership.allowedPermissions, roles: membership.roles });
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return integrationsPageFixture;

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [profileResponse, connectionsResponse, capabilitiesResponse, readiness] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    request(`/workspaces/${membership.workspaceId}/integration-connections`),
    request(`/workspaces/${membership.workspaceId}/integration-capabilities`),
    platformReadiness(),
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
    ...(readiness ? { platformReadiness: readiness } : {}),
  };
}
