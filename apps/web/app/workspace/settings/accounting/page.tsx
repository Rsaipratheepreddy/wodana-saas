import { redirect } from "next/navigation";
import { AccountingSettingsPage } from "@/components/accounting/accounting-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Accounting: where each company posts to QuickBooks or Zoho Books, and with which accounts and tax codes. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <AccountingSettingsPage workspaceId={membership.workspaceId} />;
}
