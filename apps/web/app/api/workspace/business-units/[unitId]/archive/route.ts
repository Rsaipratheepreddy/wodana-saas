import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = typeof body?.version === "number" ? body.version : 0;
  if (!UUID.test(workspaceId) || !UUID.test(unitId) || version < 1) return invalidRequest("A valid workspace, unit, and version are required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/business-units/${unitId}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  }, "The business unit could not be archived.");
}
