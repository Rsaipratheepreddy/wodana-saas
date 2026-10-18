import { redirect } from "next/navigation";
import { PushTemplatesPage } from "@/components/setup/push-templates-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** §0.3, Settings → Push notifications: each moment's push as the firm words it, with a phone preview. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <PushTemplatesPage workspaceId={membership.workspaceId} />;
}
