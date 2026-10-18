import { notFound } from "next/navigation";
import { ClientView } from "@/components/client-portal/client-view";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { UUID } from "@/lib/workspace/workspace-api";

/** A case's client portal, exactly as the client sees it: a read-only preview for the team and Woddy's tours. */
export default async function ClientViewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!UUID.test(caseId)) notFound();
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) notFound();
  return <ClientView workspaceId={workspaceId} caseId={caseId} />;
}
