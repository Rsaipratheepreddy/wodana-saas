import { notFound, redirect } from "next/navigation";
import { authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(["lead", "enquiry", "opportunity", "case", "project"]);

/** §0.3 P2: a record's Journey link opens its job's page (the job is found from the record). */
export default async function JobForRecordPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (!TYPES.has(type) || !UUID.test(id)) notFound();
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) redirect("/login");
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/jobs/by-source/${type}/${id}`);
  if (result.unauthenticated) redirect("/login");
  const jobId = result.upstream?.ok ? ((await result.upstream.json()) as { jobId: string | null }).jobId : null;
  if (!jobId) notFound();
  redirect(`/workspace/jobs/${jobId}`);
}
