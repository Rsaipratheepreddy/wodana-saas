import { notFound, redirect } from "next/navigation";
import { TimelineCheckPage } from "@/components/crm/timeline-checks";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A timeline question (PLM-155), opened from its notice or My day: outside Sales, so the designers and Production
 * answer it without opening opportunities. The service shows it to the person asked and to Sales only.
 */
export default async function Page({ params }: { params: Promise<{ checkId: string }> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const { checkId } = await params;
  if (!UUID.test(checkId)) notFound();
  return <TimelineCheckPage workspaceId={membership.workspaceId} checkId={checkId} />;
}
