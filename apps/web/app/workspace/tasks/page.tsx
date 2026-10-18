import { redirect } from "next/navigation";
import { OpenWork } from "@/components/project-core/open-work";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { canOpen } from "@/lib/workspace/access";

/** Home → Tasks: open project work, the person's own or everyone's. */
export default async function TasksPage() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  // Without project work, Home's Tasks are the person's sales follow-ups (see `homeTabs`).
  const access = { permissions: membership.allowedPermissions, roles: membership.roles };
  if (Array.isArray(membership.allowedPermissions) && !canOpen("projects-overview", access) && canOpen("follow-ups", access)) redirect("/workspace/crm/follow-ups?view=activity");
  return <OpenWork workspaceId={membership.workspaceId} />;
}
