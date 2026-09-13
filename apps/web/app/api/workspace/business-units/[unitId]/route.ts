import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function PATCH(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(unitId)) return invalidRequest("A valid workspace and unit are required.");
  const payload = { ...body, workspaceId: undefined };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/business-units/${unitId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, "The business unit could not be updated.");
}
