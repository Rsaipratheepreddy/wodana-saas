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
} from "./company-profile";

export type CompanyProfilePageData = {
  canManage: boolean;
  profile: CompanyProfileData;
};

export async function getCompanyProfilePageData(): Promise<CompanyProfilePageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  const canManage = membership.roles.some((role) =>
    ["owner", "administrator"].includes(role.toLowerCase()),
  );

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return { canManage: true, profile: companyProfileFixture };
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const response = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}`), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);

  if (!response) throw new Error("The company profile service is unavailable.");
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("The company profile could not be loaded.");

  return {
    canManage,
    profile: await response.json() as CompanyProfileData,
  };
}
