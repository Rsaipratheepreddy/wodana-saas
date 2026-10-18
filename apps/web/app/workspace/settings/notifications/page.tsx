import { redirect } from "next/navigation";
import { NotificationSettingsPage } from "@/components/workspace/notification-settings-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Notifications: which channels each group reaches the signed-in person on, quiet hours and the digest. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <NotificationSettingsPage workspaceId={membership.workspaceId} />;
}
