import { notFound, redirect } from "next/navigation";
import { ChangePricePage } from "@/components/change-requests/change-record-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A change's variation in the quotation builder; back goes to the change. */
export default async function Page({ params }: { params: Promise<{ projectId: string; changeId: string }> }) {
  const { projectId, changeId } = await params;
  if (!UUID.test(projectId) || !UUID.test(changeId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ChangePricePage workspaceId={membership.workspaceId} projectId={projectId} changeId={changeId} />;
}
