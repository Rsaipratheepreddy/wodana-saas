import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const t = await getServerT();
  const { unitId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(unitId)) return invalidRequest(t("A valid workspace and unit are required."));
  const payload = { ...body, workspaceId: undefined };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/business-units/${unitId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, t("The business unit could not be updated."));
}
