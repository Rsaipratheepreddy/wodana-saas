import { redirect } from "next/navigation";
import { ReportTargetsSettings } from "@/components/reports/report-targets-settings";
import { NoAccessState } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";
import { canOpen } from "@/lib/workspace/access";

/** Settings → Report targets: the monthly KPI targets the management dashboards compare against (PLM-134). */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (!canOpen("report-targets", { permissions: membership.allowedPermissions, roles: membership.roles })) return <NoAccessState area={(await serverTranslator())("Report targets")} />;
  return <ReportTargetsSettings workspaceId={membership.workspaceId} />;
}
