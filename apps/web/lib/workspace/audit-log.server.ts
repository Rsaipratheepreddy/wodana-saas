import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import { auditLogFixture, type AuditLogPageData } from "./audit-log";

export async function getAuditLogPageData(): Promise<AuditLogPageData> {
  const authProfile = await getAuthenticatedProfile();
  const membership = authProfile.memberships[0];
  if (!membership) redirect("/login");

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return auditLogFixture;
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const response = await fetch(
    businessApiUrl(`/workspaces/${membership.workspaceId}/audit-events?limit=50`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  ).catch(() => null);

  if (response?.status === 401) redirect("/login");
  if (response?.status === 403) {
    return { canView: false, items: [], nextCursor: null, referenceTime: new Date().toISOString(), workspaceId: membership.workspaceId };
  }
  if (!response) throw new Error("The audit service is unavailable.");
  if (!response.ok) throw new Error("Audit events could not be loaded.");

  const page = await response.json() as Pick<AuditLogPageData, "items" | "nextCursor">;
  return { ...page, canView: true, referenceTime: new Date().toISOString(), workspaceId: membership.workspaceId };
}
