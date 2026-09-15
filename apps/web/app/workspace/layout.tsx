import { SessionMonitor } from "@/components/workspace/session-monitor";
import { WorkspaceShell, workspaceModules } from "@/components/workspace";
import { getAuthenticatedProfile } from "@/lib/auth/server";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await getAuthenticatedProfile();
  const workspaces = profile.memberships.map((membership) => ({
    description: "Business workspace",
    id: membership.workspaceId,
    imageUrl: membership.workspaceLogoUrl ?? undefined,
    name: membership.workspaceName,
    primaryColor: membership.workspacePrimaryColor,
  }));
  const user = { email: profile.primaryEmail, name: profile.displayName, platformRole: profile.platformRole };
  return (
    <WorkspaceShell modules={workspaceModules} user={user} workspaces={workspaces}>
      {!(process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") ? <SessionMonitor /> : null}
      {children}
    </WorkspaceShell>
  );
}
