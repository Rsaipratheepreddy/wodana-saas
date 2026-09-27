import { SessionMonitor } from "@/components/workspace/session-monitor";
import { WorkspaceShell, workspaceModules } from "@/components/workspace";
import { cookies } from "next/headers";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getMyProfile } from "@/lib/workspace/profile.server";
import { I18nProvider, LanguagePreferenceProvider } from "@/lib/i18n/i18n-provider";
import { WorkspaceRegionProvider } from "@/design-system";
import { getWorkspaceRegion, type WorkspaceRegion } from "@/lib/workspace/region.server";
import { LANGUAGE_COOKIE, chooseLanguage, supportedLanguage } from "@/lib/i18n/languages";
import { dictionaryFor, translator } from "@/lib/i18n/messages";
import { scopePeopleNavigation, scopeSupplyNavigation, visibleWorkspaceModules } from "@/lib/workspace/module-rollout";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await getAuthenticatedProfile();
  const activeMembership = profile.memberships[0];
  const ownerAccess = activeMembership?.roles.some((role) => role === "owner" || role === "administrator") ?? false;
  const allowedModules = ownerAccess
    ? (["workspace", "crm", "pre-project", "projects", "hrms"] as const)
    : activeMembership?.allowedModules ?? (["workspace", "crm", "pre-project", "projects", "hrms"] as const);
  const workspaces = profile.memberships.map((membership) => {
    return {
      accountName: membership.accountName,
      id: membership.workspaceId,
      imageUrl: membership.workspaceLogoUrl
        ? `${membership.workspaceLogoUrl}${membership.workspaceLogoUrl.includes("?") ? "&" : "?"}variant=square`
        : undefined,
      name: membership.workspaceName,
      primaryColor: membership.workspacePrimaryColor,
      secondaryColor: membership.workspaceSecondaryColor,
      headingFont: membership.workspaceHeadingFont,
      bodyFont: membership.workspaceBodyFont,
    };
  });
  // The rest of what the shell needs is independent: fetch it together, not one after another.
  const [appearance, cookieStore, region]: [Awaited<ReturnType<typeof getMyProfile>>, Awaited<ReturnType<typeof cookies>>, WorkspaceRegion] = await Promise.all([
    getMyProfile(activeMembership?.workspaceId),
    cookies(),
    process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true" ? {} : getWorkspaceRegion(activeMembership?.workspaceId, activeMembership),
  ]);
  const user = { email: profile.primaryEmail, name: profile.displayName, id: profile.id, avatarUrl: appearance?.photoUrl ?? undefined, avatarPreset: appearance?.avatarPreset ?? "auto" };
  // The root layout follows the language cookie. A person who has not chosen on this device yet gets the
  // language saved on their profile, else the workspace's default language (and this device remembers it).
  const chosen = supportedLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value);
  const language = chooseLanguage(chosen, { preferredLocale: profile.preferredLocale, workspaceLocale: region.locale ?? activeMembership?.workspaceLocale });
  const t = translator(language);
  const persist = activeMembership ? { workspaceId: activeMembership.workspaceId, workspaceLocale: region.locale ?? activeMembership.workspaceLocale } : null;
  const content = (
    <LanguagePreferenceProvider persist={persist} resolved={chosen ? undefined : language}>
    <WorkspaceRegionProvider {...region}>
    <WorkspaceShell
      modules={scopeSupplyNavigation(scopePeopleNavigation(
        visibleWorkspaceModules(workspaceModules, activeMembership?.workspaceSlug ?? "", allowedModules),
        activeMembership?.allowedPermissions,
        activeMembership?.roles ?? [],
      ), activeMembership?.allowedPermissions, activeMembership?.roles ?? [])}
      unavailableOrganizations={profile.unavailableOrganizations ?? []}
      user={user}
      workspaces={workspaces.map(({ accountName, ...workspace }) => ({ ...workspace, description: `${accountName ?? t("Organization")} · ${t("Active")}` }))}>
      {!(process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") ? <SessionMonitor /> : null}
      {children}
    </WorkspaceShell>
    </WorkspaceRegionProvider>
    </LanguagePreferenceProvider>
  );
  // Only when that differs from the cookie's language does this layout send its own dictionary.
  return chosen ? content : <I18nProvider dictionary={dictionaryFor(language)} language={language}>{content}</I18nProvider>;
}
