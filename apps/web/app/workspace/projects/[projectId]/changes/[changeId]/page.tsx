import { notFound, redirect } from "next/navigation";
import { ProjectVariation } from "@/components/project-core/project-variation";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A project's variation, built in the quotation builder; back goes to the project's scope. */
export default async function Page({ params }: { params: Promise<{ projectId: string; quoteId: string }> }) {
  const { projectId, quoteId } = await params;
  if (!UUID.test(projectId) || !/^[A-Za-z0-9_-]{1,80}$/.test(quoteId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ProjectVariation workspaceId={membership.workspaceId} projectId={projectId} quoteId={quoteId} />;
}
