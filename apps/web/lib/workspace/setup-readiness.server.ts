import "server-only";

import { cookies } from "next/headers";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { ReadinessData } from "@/components/workspace/workspace-readiness";
import { getCompanyProfilePageData } from "./company-profile.server";
import { getIntegrationsPageData } from "./integrations.server";
import { getMembersPageData } from "./members.server";
import type { TaxNumbering } from "./tax-numbering";

/** One business-core read as the signed-in person; any failure rejects, so the step reads as unknown. */
async function read<T>(path: string): Promise<T> {
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") throw new Error("No live data in end-to-end bypass.");
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error("Not signed in.");
  const response = await fetch(businessApiUrl(path), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return await response.json() as T;
}

/**
 * Which workspace setup steps are done, for the people who can do them (owners and administrators).
 * Every step is checked against real records. A source that fails answers "unknown" (null), never
 * "not done"; anyone else gets nothing.
 */
export async function getSetupReadiness(workspaceId: string): Promise<ReadinessData | null> {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership?.roles.some((role) => role === "owner" || role === "administrator")) return null;
  const [companyResult, peopleResult, connectionsResult, kitResult] = await Promise.allSettled([
    getCompanyProfilePageData(), getMembersPageData(), getIntegrationsPageData(workspaceId),
    read<{ kit: { introduction?: string | null } }>(`/workspaces/${workspaceId}/quotation/proposal-kit`),
  ]);
  const company = companyResult.status === "fulfilled" ? companyResult.value.profile : null;
  const people = peopleResult.status === "fulfilled" ? peopleResult.value : null;
  const connections = connectionsResult.status === "fulfilled" && !connectionsResult.value.loadError ? connectionsResult.value : null;
  // Tax is set up when every active business has its current tax rates (or its country has no sales tax).
  const businesses = company?.legalEntities.filter((entity) => entity.status === "active") ?? [];
  const taxResults = await Promise.allSettled(businesses.map((entity) => read<TaxNumbering>(`/workspaces/${workspaceId}/legal-entities/${entity.id}/tax-numbering`)));
  const tax = !company ? null
    : !businesses.length ? false
      : taxResults.some((result) => result.status === "rejected") ? null
        : taxResults.every((result) => result.status === "fulfilled" && (result.value.tax !== null || result.value.taxModel.model === "none"));
  return {
    company: company ? Boolean(company.legalEntities[0]?.registeredName && company.legalEntities[0]?.address?.line1) : null,
    regional: company ? Boolean(company.workspace.defaultCurrency && company.workspace.defaultTimezone && company.workspace.unitSystem) : null,
    tax,
    people: people ? people.members.length > 1 || people.invitations.some((item) => item.status === "pending") : null,
    proposalKit: kitResult.status === "fulfilled" ? Boolean(kitResult.value.kit?.introduction?.trim()) : null,
    connections: connections ? connections.connections.some((item) => item.status === "connected") : null,
  };
}
