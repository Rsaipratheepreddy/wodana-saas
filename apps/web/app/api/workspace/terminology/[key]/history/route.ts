import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const TERMINOLOGY_KEY = /^[a-z][a-z_]{1,59}$/;

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !TERMINOLOGY_KEY.test(key)) {
    return invalidRequest("A valid workspace and terminology item are required.");
  }
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/terminology/${key}/history`,
    { method: "GET" },
    "Workspace language history could not be loaded.",
  );
}
