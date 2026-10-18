import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/home/metrics`, { method: "GET" }, "Your Home figures could not be loaded.");
}
