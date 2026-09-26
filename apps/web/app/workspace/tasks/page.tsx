import { redirect } from "next/navigation";
import { OpenWork } from "@/components/project-core/open-work";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Home → Tasks: open project work, the person's own or everyone's. */
export default async function TasksPage() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <OpenWork workspaceId={membership.workspaceId} />;
}
