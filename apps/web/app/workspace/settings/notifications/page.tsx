import { redirect } from "next/navigation";
import { NotificationSettingsPage } from "@/components/workspace/notification-settings-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Notifications: what each module tells the signed-in person, where, and quiet hours. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <NotificationSettingsPage workspaceId={membership.workspaceId} userId={profile.id} />;
}
