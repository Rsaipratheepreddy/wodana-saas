import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { isWorkspaceAdministrator } from "@/lib/workspace/access";
import { leadsPageFixture, type LeadsPageData } from "./leads";
import { roleVocabularyKeys, withRoleVocabulary, type LeadOptions } from "./lead-options";

export async function getLeadsPageData(): Promise<LeadsPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return leadsPageFixture;
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const response = await fetch(
    businessApiUrl(`/workspaces/${membership.workspaceId}/crm/leads?limit=100`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  ).catch(() => null);

  if (response?.status === 401) redirect("/login");
  if (response?.status === 403) {
    return {
      canView: false,
      items: [],
      queues: [], assignmentPolicies: [], slaPolicies: [], intake: [], pipelines: [], members: [], salesOwners: [],
      nextCursor: null,
      referenceTime: new Date().toISOString(),
      workspaceId: membership.workspaceId,
    };
  }
  if (!response) throw new Error("The CRM service is unavailable.");
  if (!response.ok) throw new Error("Leads could not be loaded.");

  const page = await response.json() as Pick<LeadsPageData, "items" | "nextCursor"> & { data?: LeadsPageData["items"] };
  const supporting = await Promise.all(["crm/queues", "crm/assignment-policies", "crm/sla-policies", "crm/intake-inbox?limit=100", "crm/pipelines", "members", "crm/lead-options", "crm/enquiry-fields", "crm/sales-settings"].map(async (path) => {
    const result = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/${path}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const single = path === "crm/lead-options" || path === "crm/enquiry-fields" || path === "crm/sales-settings";
    if (result.status === 403) return single && path !== "crm/lead-options" ? undefined : [];
    // An older server without Sales settings keeps the page working with the defaults.
    if (path === "crm/sales-settings" && result.status === 404) return undefined;
    if (!result.ok) throw new Error("CRM configuration could not be loaded.");
    const payload = await result.json();
    return single ? payload : Array.isArray(payload) ? payload : payload.data ?? [];
  }));
  const workspaceResponse = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  // PLM-155: the teams whose people answer timeline questions are chosen in the Sales settings (only by those who manage them).
  const teamsResponse = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/teams`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  const teams = teamsResponse?.ok ? ((await teamsResponse.json()) as Array<{ code: string; name: string; status: string }>).filter((team) => team.status === "active").map(({ code, name }) => ({ code, name })) : [];
  const workspace = workspaceResponse.ok ? await workspaceResponse.json() : null;
  // The sales owners come from their own list: a salesperson may not read the member directory.
  const ownersResponse = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/crm/sales-owners`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!ownersResponse.ok && ownersResponse.status !== 403) throw new Error("CRM configuration could not be loaded.");
  const owners = ownersResponse.ok
    ? await ownersResponse.json() as { items: LeadsPageData["members"]; currentMembershipId: string | null }
    : { items: [], currentMembershipId: null };
  const currentMembership = authProfile.memberships.find((entry) => entry.workspaceId === membership.workspaceId);
  // One role vocabulary: the member's roles and teams, lower-case, against the sources' saved limits.
  const leadOptions = withRoleVocabulary(supporting[6] as LeadOptions | undefined);
  return {
    defaultCurrency: workspace?.workspace?.defaultCurrency,
    defaultLocale: workspace?.workspace?.defaultLocale,
    canView: true,
    currentRoles: roleVocabularyKeys(currentMembership?.roles, leadOptions?.roleKeys),
    canManagePipelines: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.settings.manage"),
    canAssign: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.leads.assign"),
    canEdit: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.leads.manage"),
    canManageSales: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.settings.manage"),
    canChangeIdentity: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.parties.identity"),
    // PLM-138: clears a wrong spam flag (owners and administrators by default).
    canUnmarkSpam: isWorkspaceAdministrator(currentMembership?.roles) || (currentMembership?.allowedPermissions ?? []).includes("crm.spam.unmark"),
    currentMembershipId: owners.currentMembershipId
      ?? (supporting[5] as LeadsPageData["members"]).find(member => member.email.toLowerCase() === authProfile.primaryEmail.toLowerCase())?.id,
    salesOwners: owners.items,
    leadOptions,
    enquiryFields: supporting[7] as LeadsPageData["enquiryFields"],
    salesSettings: supporting[8] as LeadsPageData["salesSettings"],
    teams,
    items: page.data ?? page.items ?? [],
    queues: supporting[0], assignmentPolicies: supporting[1], slaPolicies: supporting[2], intake: supporting[3], pipelines: supporting[4], members: supporting[5],
    nextCursor: page.nextCursor,
    referenceTime: new Date().toISOString(),
    workspaceId: membership.workspaceId,
  };
}
