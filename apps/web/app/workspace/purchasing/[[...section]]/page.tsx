import { redirect } from "next/navigation";
import { PurchasingPage } from "@/components/purchasing/purchasing-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Purchasing: the supplier register. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <PurchasingPage workspaceId={membership.workspaceId} />;
}
