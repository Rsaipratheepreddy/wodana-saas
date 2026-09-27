import "server-only";

import { getAuthenticatedProfile } from "@/lib/auth/server";
import type { ReadinessData } from "@/components/workspace/workspace-readiness";
import { getCompanyProfilePageData } from "./company-profile.server";
import { getIntegrationsPageData } from "./integrations.server";
import { getMembersPageData } from "./members.server";

/**
 * Which workspace setup steps are done, for the people who can do them (owners and administrators).
 * A source that fails answers "unknown" (null), never "not done"; anyone else gets nothing.
 */
export async function getSetupReadiness(workspaceId: string): Promise<ReadinessData | null> {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership?.roles.some((role) => role === "owner" || role === "administrator")) return null;
  const [companyResult, peopleResult, connectionsResult] = await Promise.allSettled([getCompanyProfilePageData(), getMembersPageData(), getIntegrationsPageData(workspaceId)]);
  const company = companyResult.status === "fulfilled" ? companyResult.value.profile : null;
  const people = peopleResult.status === "fulfilled" ? peopleResult.value : null;
  const connections = connectionsResult.status === "fulfilled" && !connectionsResult.value.loadError ? connectionsResult.value : null;
  return {
    company: company ? Boolean(company.legalEntities[0]?.registeredName && company.legalEntities[0]?.address?.line1) : null,
    regional: company ? Boolean(company.workspace.defaultCurrency && company.workspace.defaultTimezone && company.workspace.unitSystem) : null,
    people: people ? people.members.length > 1 || people.invitations.some((item) => item.status === "pending") : null,
    connections: connections ? connections.connections.some((item) => item.status === "connected") : null,
  };
}
