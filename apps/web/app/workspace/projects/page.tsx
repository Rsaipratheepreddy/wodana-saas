import { redirect } from "next/navigation";
import { ProjectsPage } from "@/components/project-core/projects-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Projects: every project the person can see. A project starts from an accepted quotation. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const health = (await searchParams).health;
  const initialHealth = health === "late" || health === "at-risk" || health === "on-track" ? health : undefined;
  return <ProjectsPage workspaceId={membership.workspaceId} initialHealth={initialHealth} />;
}
