import { notFound, redirect } from "next/navigation";
import { ProjectPage } from "@/components/project-core/project-page";
import { PROJECT_SECTIONS, type ProjectSection } from "@/lib/project-core/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One project: Overview (stages), Scope (the sealed scope), Plan (its work) and Updates. Any other section opens the Overview. */
export default async function Page({ params }: { params: Promise<{ projectId: string; section?: string[] }> }) {
  const { projectId, section } = await params;
  if (!UUID.test(projectId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "overview";
  if (section && (section.length > 1 || !PROJECT_SECTIONS.includes(requested as ProjectSection))) redirect(`/workspace/projects/${projectId}`);
  return <ProjectPage workspaceId={membership.workspaceId} projectId={projectId} section={requested as ProjectSection} />;
}
