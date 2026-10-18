import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const payload = { ...body, workspaceId: undefined };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/teams`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, t("The team could not be created."));
}
