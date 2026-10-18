import { redirect } from "next/navigation";
import { PurchasingSettingsPage } from "@/components/purchasing/purchasing-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Purchasing: when orders need approval, and what must be true before one is placed. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <PurchasingSettingsPage workspaceId={membership.workspaceId} />;
}
