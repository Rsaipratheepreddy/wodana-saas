import { redirect } from "next/navigation";
import { ProjectsPage } from "@/components/project-core/projects-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Projects: every project the person can see. A project starts from an accepted quotation. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const query = await searchParams;
  const health = query.health;
  const initialHealth = health === "late" || health === "at-risk" || health === "on-track" ? health : undefined;
  // "Ready to start" (PLM-056) opens the start of that case's project.
  const start = typeof query.start === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.start) ? query.start : undefined;
  return <ProjectsPage workspaceId={membership.workspaceId} initialHealth={initialHealth} initialStart={start} />;
}
