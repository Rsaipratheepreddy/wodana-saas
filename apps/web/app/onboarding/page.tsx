import { getIntegrationsPageData } from "@/lib/workspace/integrations.server";
import { getMembersPageData } from "@/lib/workspace/members.server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { I18nProvider, LanguagePreferenceProvider } from "@/lib/i18n/i18n-provider";
import { LANGUAGE_COOKIE, chooseLanguage, supportedLanguage } from "@/lib/i18n/languages";
import { dictionaryFor } from "@/lib/i18n/messages";
import { getServerT } from "@/lib/i18n/server";
import { getBillingPageData } from "@/lib/workspace/billing.server";
import { redirect, unstable_rethrow } from "next/navigation";
import { OnboardingFlow } from "./onboarding-flow";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getCompanyProfilePageData } from "@/lib/workspace/company-profile.server";
import { canSetUpWorkspace } from "@/lib/workspace/access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Set up your workspace · Wodana"), description: t("Complete the first-time setup for your Wodana workspace.") };
}

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
  // Only the owner or an administrator sets the workspace up; everyone else waits on their Home.
  if (onboarding.status === "completed" || !canSetUpWorkspace(membership.roles)) redirect("/workspace");
  const { canManage, profile } = await getCompanyProfilePageData();
  if (!canManage || !profile.legalEntities[0]) redirect("/workspace");
  // Not chosen on this device yet: the profile's language, else the workspace default (the person can switch).
  const chosen = supportedLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  const language = chooseLanguage(chosen, { preferredLocale: auth.preferredLocale, workspaceLocale: profile.workspace.defaultLocale });
  const billing = await getBillingPageData().catch((error: unknown) => { unstable_rethrow(error); return null; });
  const people = await getMembersPageData().catch((error: unknown) => { unstable_rethrow(error); return null; });
  // Show the enforced limit; a workspace without any seat limit shows no seat summary.
  const seatLimit = billing?.usage.seatLimit;
  const seatCapacity = billing && typeof seatLimit === "number" && seatLimit > 0
    ? { allocated: seatLimit, reserved: billing.usage.reservedSeats, pending: billing.usage.pendingInvitations }
    : null;
  const flow = (
    <OnboardingFlow
      integrationData={await getIntegrationsPageData().catch((error: unknown) => { unstable_rethrow(error); return undefined; })}
      oauthResult={{ code: typeof query.code === "string" ? query.code : undefined, result: typeof query.integration === "string" ? query.integration : typeof query.google === "string" ? query.google : undefined }}
      initialData={profile}
      seatCapacity={seatCapacity}
      seatsUnavailable={billing === null}
      availableRoles={people?.canManage ? people.roles.filter(role => role.code !== "owner").map(role => ({ id: role.code, label: role.name })) : []}
      initialInvites={people?.invitations.filter(invite => invite.status === "pending").map(invite => ({ email: invite.email, roles: invite.roles })) ?? []}
      initialOnboarding={onboarding}
      isPreview={preview}
      userName={auth.displayName}
    />
  );
  const persisted = <LanguagePreferenceProvider persist={{ workspaceId: membership.workspaceId, workspaceLocale: profile.workspace.defaultLocale }} resolved={chosen ? undefined : language}>{flow}</LanguagePreferenceProvider>;
  return chosen ? persisted : <I18nProvider dictionary={dictionaryFor(language)} language={language}>{persisted}</I18nProvider>;
}
