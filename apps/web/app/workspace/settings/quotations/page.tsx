import { redirect } from "next/navigation";
import { QuotationSettingsPage } from "@/components/quotation/quotation-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Quotations: pricing rules and work packages. The API decides who may change them. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <QuotationSettingsPage workspaceId={membership.workspaceId} />;
}
