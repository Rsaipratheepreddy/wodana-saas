import { redirect } from "next/navigation";
import { ProjectSettingsPage } from "@/components/project-core/project-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Projects: start rules, team roles and routes. The API decides who may change them. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ProjectSettingsPage workspaceId={membership.workspaceId} />;
}
