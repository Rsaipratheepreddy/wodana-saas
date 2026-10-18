import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const t = await getServerT();
  const { teamId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(teamId)) return invalidRequest(t("A valid workspace and team are required."));
  const payload = { ...body, workspaceId: undefined };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/teams/${teamId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, t("The team could not be updated."));
}
