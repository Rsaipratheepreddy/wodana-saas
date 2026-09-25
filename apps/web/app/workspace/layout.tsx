import { SessionMonitor } from "@/components/workspace/session-monitor";
import { WorkspaceShell, workspaceModules } from "@/components/workspace";
import { getAuthenticatedProfile } from "@/lib/auth/server";
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
      description: `${membership.accountName ?? "Organization"} · Active`,
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
  const user = { email: profile.primaryEmail, name: profile.displayName };
  return (
    <WorkspaceShell
      modules={scopeSupplyNavigation(scopePeopleNavigation(
        visibleWorkspaceModules(workspaceModules, activeMembership?.workspaceSlug ?? "", allowedModules),
        activeMembership?.allowedPermissions,
        activeMembership?.roles ?? [],
      ), activeMembership?.allowedPermissions, activeMembership?.roles ?? [])}
      unavailableOrganizations={profile.unavailableOrganizations ?? []}
      user={user}
      workspaces={workspaces}>
      {!(process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") ? <SessionMonitor /> : null}
      {children}
    </WorkspaceShell>
  );
}
