import { redirect } from "next/navigation";
import { PortalSettingsPage } from "@/components/client-portal/settings/portal-settings-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Client portal: whether clients can sign in, what they see, the welcome and support contacts. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <PortalSettingsPage workspaceId={membership.workspaceId} />;
}
