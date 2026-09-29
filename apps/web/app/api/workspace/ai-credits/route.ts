import { UUID, invalidRequest, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Settings → AI credits: the workspace's balance, this month's use by feature and its ledger (owners and administrators). */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/ai-credits`, { method: "GET" }, t("AI credits didn't load."));
}
