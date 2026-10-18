import { notFound, redirect } from "next/navigation";
import { WorkspaceRegionProvider } from "@/design-system";
import { DailyReportPrint } from "@/components/site/progress-print";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWorkspaceRegion } from "@/lib/workspace/region.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A day's progress report to print or save as PDF: the client's card for the day, in the firm's name. */
export default async function Page({ params, searchParams }: {
  params: Promise<{ reportId: string }>; searchParams: Promise<{ workspaceId?: string; projectId?: string }>;
}) {
  const { reportId } = await params;
  const { workspaceId, projectId = "" } = await searchParams;
  if (!UUID.test(reportId) || !UUID.test(projectId)) notFound();
  const profile = await getAuthenticatedProfile();
  if (!profile.memberships.length) redirect("/login");
  const membership = workspaceId ? profile.memberships.find((item) => item.workspaceId === workspaceId) : profile.memberships[0];
  if (!membership) notFound();
  return <WorkspaceRegionProvider {...await getWorkspaceRegion(membership.workspaceId, membership)}>
    <DailyReportPrint workspaceId={membership.workspaceId} projectId={projectId} reportId={reportId} />
  </WorkspaceRegionProvider>;
}
