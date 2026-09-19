import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const { entityId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !isVersion(body?.version)) {
    return invalidRequest("A valid workspace, legal entity, and version are required.");
  }
  const payload = { ...body };
  delete payload.workspaceId;
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, "The legal entity could not be saved.");
}

