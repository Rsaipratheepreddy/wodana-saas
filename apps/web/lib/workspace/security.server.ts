import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, REFRESH_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { securityPageFixture, type SecurityPageData } from "./security";

export async function getSecurityPageData(): Promise<SecurityPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return securityPageFixture;
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!accessToken || !refreshToken) redirect("/login");
  const response = await fetch(businessApiUrl("/security/sessions/query"), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ refreshToken, workspaceId: membership.workspaceId }),
    cache: "no-store",
  }).catch(() => null);

  if (response?.status === 401) redirect("/login");
  if (!response) throw new Error("The security service is unavailable.");
  if (!response.ok) throw new Error("Security settings could not be loaded.");
  const security = await response.json() as Omit<SecurityPageData, "currentUserEmail" | "currentUserName" | "referenceTime" | "workspaceId">;
  return {
    ...security,
    currentUserEmail: authProfile.primaryEmail,
    currentUserName: authProfile.displayName,
    referenceTime: new Date().toISOString(),
    workspaceId: membership.workspaceId,
  };
}
