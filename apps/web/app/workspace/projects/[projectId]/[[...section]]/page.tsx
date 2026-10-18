import { notFound, redirect } from "next/navigation";
import { ProjectPage } from "@/components/project-core/project-page";
import { PROJECT_SECTIONS, SECTION_ALIASES, type ProjectSection } from "@/lib/project-core/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One project, one tab at a time: Overview, Scope, Plan, Money, Site, Handover, Updates. Petty cash and
 * warranty links from before open their view inside Money and Handover; any other section opens the Overview.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string; section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId, section } = await params;
  if (!UUID.test(projectId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "overview";
  const alias = SECTION_ALIASES[requested];
  if (alias && section?.length === 1) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
    query.set("view", alias.view);
    redirect(`/workspace/projects/${projectId}/${alias.section}?${query}`);
  }
  if (section && (section.length > 1 || !PROJECT_SECTIONS.includes(requested as ProjectSection))) redirect(`/workspace/projects/${projectId}`);
  return <ProjectPage workspaceId={membership.workspaceId} projectId={projectId} section={requested as ProjectSection} />;
}
