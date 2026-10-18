import { notFound, redirect } from "next/navigation";
import { ChangeRecordPage } from "@/components/change-requests/change-record-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One change on a project (Scope, Price, Timeline impact, Approvals, Activity). A link from before changes were raised
 * on projects names a variation quotation instead: it opens in the quotation builder, with the project as its way back.
 */
export default async function Page({ params }: { params: Promise<{ projectId: string; changeId: string }> }) {
  const { projectId, changeId } = await params;
  if (!UUID.test(projectId) || !/^[A-Za-z0-9_-]{1,80}$/.test(changeId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ChangeRecordPage workspaceId={membership.workspaceId} projectId={projectId} changeId={changeId} />;
}
