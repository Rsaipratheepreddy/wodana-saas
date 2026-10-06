import { redirect } from "next/navigation";
import { PathRulesSettingsPage } from "@/components/fulfilment/path-rules-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Orders by path: per enquiry type and path, the BOQ, stock events and lead times (PLM-083/125/126). */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <PathRulesSettingsPage workspaceId={membership.workspaceId} />;
}
