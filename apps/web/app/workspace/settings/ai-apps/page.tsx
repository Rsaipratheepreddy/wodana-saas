import { redirect } from "next/navigation";
import { AiAppsPage } from "@/components/workspace/ai-apps-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Connections → AI apps: whether AI apps may connect over MCP, and the apps connected. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <AiAppsPage workspaceId={membership.workspaceId} />;
}
