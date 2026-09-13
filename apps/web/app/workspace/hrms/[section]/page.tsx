import { notFound } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { hrmsSections, type HrmsSection } from "@/lib/hrms/navigation";
import { HrmsWorkspace } from "@/components/hrms/hrms-workspace";
export default async function HrmsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!hrmsSections.includes(section as HrmsSection)) notFound();
  const profile = await getAuthenticatedProfile(),
    workspaceId = profile.memberships[0]?.workspaceId;
  return workspaceId ? (
    <HrmsWorkspace
      key={`${workspaceId}:${section}`}
      workspaceId={workspaceId}
      section={section as HrmsSection}
    />
  ) : (
    <p>Choose a workspace to open HRMS.</p>
  );
}
