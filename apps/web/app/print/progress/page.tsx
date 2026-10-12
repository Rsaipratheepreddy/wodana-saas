import { notFound, redirect } from "next/navigation";
import { WorkspaceRegionProvider } from "@/design-system";
import { PeriodReportPrint } from "@/components/site/progress-print";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWorkspaceRegion } from "@/lib/workspace/region.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A project's progress report for a period, to print or save as PDF: the client's card of each approved day, in the firm's name. */
export default async function Page({ searchParams }: { searchParams: Promise<{ workspaceId?: string; projectId?: string; from?: string; to?: string }> }) {
  const { workspaceId, projectId = "", from = "", to = "" } = await searchParams;
  if (!UUID.test(projectId) || !DATE.test(from) || !DATE.test(to)) notFound();
  const profile = await getAuthenticatedProfile();
  if (!profile.memberships.length) redirect("/login");
  const membership = workspaceId ? profile.memberships.find((item) => item.workspaceId === workspaceId) : profile.memberships[0];
  if (!membership) notFound();
  return <WorkspaceRegionProvider {...await getWorkspaceRegion(membership.workspaceId, membership)}>
    <PeriodReportPrint workspaceId={membership.workspaceId} projectId={projectId} from={from} to={to} />
  </WorkspaceRegionProvider>;
}
