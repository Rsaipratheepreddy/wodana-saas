import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const t = await getServerT();
  const { teamId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(teamId)) return invalidRequest(t("A valid workspace and team are required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/teams/${teamId}/history`, { method: "GET" }, t("Team history could not be loaded."));
}
