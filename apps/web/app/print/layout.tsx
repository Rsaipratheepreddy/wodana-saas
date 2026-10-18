import type { ReactNode } from "react";
import { WorkspaceIdentityProvider } from "@/components/workspace/workspace-identity";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";

/**
 * Printed staff documents (orders, moves, material lists, site reports) carry the workspace's own name, logo and
 * brand colour where the issuing business has no letterhead; each page checks the person's access itself.
 */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const membership = (await getAuthenticatedProfile().catch(() => null))?.memberships[0] ?? null;
  return <WorkspaceIdentityProvider identity={membership ? { name: membership.workspaceName, logoUrl: membership.workspaceLogoUrl } : null}>
    <div style={workspacePrimaryColorStyle(membership ? { primaryColor: membership.workspacePrimaryColor, secondaryColor: membership.workspaceSecondaryColor } : null)}>{children}</div>
  </WorkspaceIdentityProvider>;
}
