import { redirect } from "next/navigation";
import { CommissionTypesPage } from "@/components/setup/commission-types-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** §0.3 P3, Settings → Commissions: the commission types a deal file offers, named by the firm. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <CommissionTypesPage workspaceId={membership.workspaceId} />;
}
