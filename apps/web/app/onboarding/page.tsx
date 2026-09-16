import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "./onboarding-flow";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getCompanyProfilePageData } from "@/lib/workspace/company-profile.server";

export const metadata: Metadata = {
  title: "Set up your workspace · Wodana",
  description: "Complete the first-time setup for your Wodana workspace.",
};

export default async function OnboardingPage() {
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
  return (
    <OnboardingFlow
      initialData={profile}
      initialOnboarding={onboarding}
      isPreview={preview}
      userName={auth.displayName}
    />
  );
}
