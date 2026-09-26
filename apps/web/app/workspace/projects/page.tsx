import { redirect } from "next/navigation";
import { ProjectsPage } from "@/components/project-core/projects-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Projects: every project the person can see. A project starts from an accepted quotation. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ProjectsPage workspaceId={membership.workspaceId} />;
}
