import { getIntegrationsPageData } from "@/lib/workspace/integrations.server";
import { getMembersPageData } from "@/lib/workspace/members.server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { getBillingPageData } from "@/lib/workspace/billing.server";
import { redirect, unstable_rethrow } from "next/navigation";
import { OnboardingFlow } from "./onboarding-flow";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getCompanyProfilePageData } from "@/lib/workspace/company-profile.server";

export const metadata: Metadata = {
  title: "Set up your workspace · Wodana",
  description: "Complete the first-time setup for your Wodana workspace.",
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const auth = await getAuthenticatedProfile();
  const membership = auth.memberships[0];
  if (!membership) redirect("/login");
  const preview = process.env.NODE_ENV !== "production"
    && process.env.E2E_AUTH_BYPASS === "true"
    && process.env.E2E_ONBOARDING_PREVIEW === "true";
  const onboarding = preview
    ? { status: "not_started" as const, currentStep: "workspace_profile" as const, completedSteps: [], version: 1 }
    : membership.onboarding;
  if (onboarding.status === "completed") redirect("/workspace");
  const { canManage, profile } = await getCompanyProfilePageData();
  if (!canManage || !profile.legalEntities[0]) redirect("/workspace");
  const language = resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value ?? profile.workspace.defaultLocale);
  const billing = await getBillingPageData().catch((error: unknown) => { unstable_rethrow(error); return null; });
  const people = await getMembersPageData().catch((error: unknown) => { unstable_rethrow(error); return null; });
  // Show the enforced limit; a workspace without any seat limit shows no seat summary.
  const seatLimit = billing?.usage.seatLimit;
  const seatCapacity = billing && typeof seatLimit === "number" && seatLimit > 0
    ? { allocated: seatLimit, reserved: billing.usage.reservedSeats, pending: billing.usage.pendingInvitations }
    : null;
  return (
    <OnboardingFlow
      integrationData={await getIntegrationsPageData().catch((error: unknown) => { unstable_rethrow(error); return undefined; })}
      oauthResult={{ code: typeof query.code === "string" ? query.code : undefined, result: typeof query.integration === "string" ? query.integration : typeof query.google === "string" ? query.google : undefined }}
      initialData={profile}
      initialLanguage={language}
      seatCapacity={seatCapacity}
      seatsUnavailable={billing === null}
      availableRoles={people?.canManage ? people.roles.filter(role => role.code !== "owner").map(role => ({ id: role.code, label: role.name })) : []}
      initialInvites={people?.invitations.filter(invite => invite.status === "pending").map(invite => ({ email: invite.email, roles: invite.roles })) ?? []}
      initialOnboarding={onboarding}
      isPreview={preview}
      userName={auth.displayName}
    />
  );
}
