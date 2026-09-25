import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { WorkspaceBillingData } from "@/lib/internal/types";

const fixture: WorkspaceBillingData = {
  workspace: { id: "00000000-0000-4000-8000-000000000002", name: "Iglo Architects", status: "active", defaultCurrency: "INR" },
  account: { id: "00000000-0000-4000-8000-000000000003", displayName: "Iglo Architects" },
  contract: { version: 1, status: "trial_uncontracted", planCode: "starter", planVersion: 1,
    currency: "INR", billingCycle: "monthly", recurringAmount: "0", seatLimit: 5, projectLimit: 25,
    trialEndsAt: null, termStartsAt: new Date().toISOString(), renewsAt: null, endsAt: null,
    taxValidationState: "unverified", effectiveFrom: new Date().toISOString(), effectiveUntil: null },
  organizationAllocation: { version: 1, status: "active", allocatedAmount: "0", seatLimit: 5,
    projectLimit: 25, effectiveFrom: new Date().toISOString(), effectiveUntil: null },
  collection: { version: 1, status: "current", overdueAmount: "0", currency: "INR",
    effectiveAt: new Date().toISOString(), nextReviewAt: null },
  accessPolicy: { state: "trial", effect: "unchanged", warning: false, actionDueAt: null,
    affectedModules: [], message: "Trial access follows the current organization allocation." },
  usage: { seatLimit: 5, members: 1, invitedMembers: 0, pendingInvitations: 0, reservedSeats: 1, projects: 0 },
  accountUsageSnapshot: null,
  documents: [],
  authority: "account_contract",
  taxCompliance: "unverified",
  observedAt: new Date().toISOString(),
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
