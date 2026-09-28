import { redirect } from "next/navigation";
import { NotificationsPage } from "@/components/workspace/notifications-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Home › Notifications: every notice for the signed-in person, opened from the bell. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <NotificationsPage workspaceId={membership.workspaceId} userId={profile.id} />;
}
