import { redirect } from "next/navigation";
import { AttendanceSettingsPage } from "@/components/hrms/attendance-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Attendance & leave: work calendars and their holidays, kinds of leave, workplaces and the attendance rules. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <AttendanceSettingsPage workspaceId={membership.workspaceId} />;
}
