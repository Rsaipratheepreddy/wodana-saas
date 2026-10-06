import { notFound, redirect } from "next/navigation";
import { ManagementReports } from "@/components/reports/management-reports";
import { NoAccessState } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";
import { DASHBOARDS, type DashboardId } from "@/lib/reports/management";
import { canOpen } from "@/lib/workspace/access";

/** Reports: the management dashboards (PLM-134) — Owner overview, Sales and pipeline, Lead response, Design projects. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (!canOpen("management-reports", { permissions: membership.allowedPermissions, roles: membership.roles })) return <NoAccessState area={(await serverTranslator())("Reports")} />;
  if ((section?.length ?? 0) > 1) notFound();
  const requested = section?.[0] ?? "owner-overview";
  if (!(DASHBOARDS as readonly string[]).includes(requested)) notFound();
  return <ManagementReports workspaceId={membership.workspaceId} initialDashboard={requested as DashboardId} />;
}
