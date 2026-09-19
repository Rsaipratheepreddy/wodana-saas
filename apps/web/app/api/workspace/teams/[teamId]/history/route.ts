import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(teamId)) return invalidRequest("A valid workspace and team are required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/teams/${teamId}/history`, { method: "GET" }, "Team history could not be loaded.");
}
