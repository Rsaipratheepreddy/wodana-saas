import { notFound, redirect } from "next/navigation";
import { ManagementReports } from "@/components/reports/management-reports";
import { NoAccessState } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";
import { DASHBOARDS, MOVED_DASHBOARDS, type DashboardId } from "@/lib/reports/management";
import { canOpen, meetsRule, REPORT_DASHBOARD_ACCESS } from "@/lib/workspace/access";

/**
 * Reports: the management dashboards (PLM-134) — Overview (the landing), Sales and marketing, Design, Production and
 * delivery, Finance and Stock; each tab only for whoever reads its area.
 */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const access = { permissions: membership.allowedPermissions, roles: membership.roles };
  if (!canOpen("management-reports", access)) return <NoAccessState area={(await serverTranslator())("Reports")} />;
  if ((section?.length ?? 0) > 1) notFound();
  const asked = section?.[0] ?? "owner-overview";
  if (MOVED_DASHBOARDS[asked]) redirect(`/workspace/reports/${MOVED_DASHBOARDS[asked]}`);
  if (!(DASHBOARDS as readonly string[]).includes(asked)) notFound();
  const allowed = DASHBOARDS.filter((id) => meetsRule(REPORT_DASHBOARD_ACCESS[id], access));
  if (!allowed.includes(asked as DashboardId)) return <NoAccessState area={(await serverTranslator())("Reports")} />;
  return <ManagementReports workspaceId={membership.workspaceId} initialDashboard={asked as DashboardId} dashboards={allowed} access={access} />;
}
