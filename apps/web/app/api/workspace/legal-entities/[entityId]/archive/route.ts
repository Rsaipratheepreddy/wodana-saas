import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const { entityId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const version = body?.version;
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return invalidRequest("A valid workspace, legal entity, and version are required.");
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  }, "The legal entity could not be archived.");
}
