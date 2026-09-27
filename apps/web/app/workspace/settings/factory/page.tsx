import { redirect } from "next/navigation";
import { FactorySettingsPage } from "@/components/factory/factory-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Factory: what a work order needs before it's released, quality checks and workcenters. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <FactorySettingsPage workspaceId={membership.workspaceId} />;
}
