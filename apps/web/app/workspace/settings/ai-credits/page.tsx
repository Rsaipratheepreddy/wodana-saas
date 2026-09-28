import { redirect } from "next/navigation";
import { AiCreditsPage } from "@/components/workspace/ai-credits-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Company → AI credits: balance, this month's use and the ledger. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <AiCreditsPage workspaceId={membership.workspaceId} />;
}
