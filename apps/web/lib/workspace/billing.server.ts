import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { WorkspaceBillingData } from "@/lib/internal/types";

const fixture: WorkspaceBillingData = {
  workspace: { id: "00000000-0000-4000-8000-000000000002", name: "Iglo Architects", status: "active", defaultCurrency: "INR" },
  subscription: { amount: "0", billingCycle: "monthly", currency: "INR", planCode: "starter", projectLimit: 25, renewsAt: null, seatLimit: 5, startedAt: new Date().toISOString(), status: "trial", updatedAt: new Date().toISOString(), version: 1 },
  usage: { members: 1, projects: 0 },
};

export async function getBillingPageData(): Promise<WorkspaceBillingData> {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return fixture;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const response = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/billing`), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (response?.status === 401) redirect("/login");
  if (!response) throw new Error("The billing service is unavailable.");
  if (!response.ok) throw new Error("Billing could not be loaded.");
  return response.json() as Promise<WorkspaceBillingData>;
}
