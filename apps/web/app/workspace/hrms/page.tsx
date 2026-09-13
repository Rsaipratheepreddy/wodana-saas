import { getAuthenticatedProfile } from "@/lib/auth/server";
import { HrmsWorkspace } from "@/components/hrms/hrms-workspace";
export default async function HrmsPage() {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  return workspaceId ? (
    <HrmsWorkspace workspaceId={workspaceId} />
  ) : (
    <p>Choose a workspace to open HRMS.</p>
  );
}
