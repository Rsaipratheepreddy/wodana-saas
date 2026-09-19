import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  businessApiUrl,
  getAuthenticatedProfile,
} from "@/lib/auth/server";
import {
  companyProfileFixture,
  type CompanyProfileData,
  type WorkspaceTerminologyData,
} from "./company-profile";
import type { CustomerAccount, OrganizationRequest } from "./customer-account";

export type CompanyProfilePageData = {
  canManage: boolean;
  profile: CompanyProfileData;
  organizationAccount: CustomerAccount | null;
  organizationAccountUnavailable: boolean;
  organizationRequests: OrganizationRequest[];
  terminology: WorkspaceTerminologyData | null;
  terminologyUnavailable: boolean;
};

export async function getCompanyProfilePageData(): Promise<CompanyProfilePageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  const canManage = membership.roles.some((role) =>
    ["owner", "administrator"].includes(role.toLowerCase()),
  );

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return {
      canManage: true,
      profile: companyProfileFixture,
      organizationAccount: null,
      organizationAccountUnavailable: false,
      organizationRequests: [],
      terminology: {
        items: Object.entries(companyProfileFixture.terminology).map(([key, value]) => ({
          key,
          defaultVisibleName: value.visibleName,
          defaultVisibleNamePlural: value.visibleNamePlural,
          ...value,
          overridden: false,
          version: 0,
          updatedAt: null,
        })),
        map: companyProfileFixture.terminology,
      },
      terminologyUnavailable: false,
    };
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = (path: string) => fetch(businessApiUrl(path), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  const [response, accountResponse, requestsResponse, terminologyResponse] = await Promise.all([
    request(`/workspaces/${membership.workspaceId}`),
    canManage ? request(`/workspaces/${membership.workspaceId}/account`) : Promise.resolve(null),
    canManage ? request(`/workspaces/${membership.workspaceId}/account/organization-requests`) : Promise.resolve(null),
    request(`/workspaces/${membership.workspaceId}/terminology`),
  ]);

  if (!response) throw new Error("The company profile service is unavailable.");
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("The company profile could not be loaded.");

  if ([accountResponse, requestsResponse, terminologyResponse].some((item) => item?.status === 401)) redirect("/login");
  const organizationAccountUnavailable = canManage && (!accountResponse || !requestsResponse || !accountResponse.ok || !requestsResponse.ok);
  const terminologyUnavailable = !terminologyResponse || !terminologyResponse.ok;

  return {
    canManage,
    profile: await response.json() as CompanyProfileData,
    organizationAccount: !organizationAccountUnavailable && accountResponse
      ? await accountResponse.json() as CustomerAccount
      : null,
    organizationAccountUnavailable,
    organizationRequests: !organizationAccountUnavailable && requestsResponse
      ? await requestsResponse.json() as OrganizationRequest[]
      : [],
    terminology: !terminologyUnavailable && terminologyResponse
      ? await terminologyResponse.json() as WorkspaceTerminologyData
      : null,
    terminologyUnavailable,
  };
}
