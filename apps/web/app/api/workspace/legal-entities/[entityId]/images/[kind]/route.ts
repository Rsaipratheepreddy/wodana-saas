import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

type Params = { params: Promise<{ entityId: string; kind: string }> };
const KINDS = ["logo", "letterhead"];

/** Starts uploading a business's logo or letterhead header (PLM-112). */
export async function POST(request: Request, { params }: Params) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId, kind } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !KINDS.includes(kind)) return invalidRequest(t("A valid upload is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/images/${kind}/uploads`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: body?.filename, mimeType: body?.mimeType, byteSize: body?.byteSize }),
  }, t("The image upload could not be started."));
}

/** Removes a business's logo or letterhead header. */
export async function DELETE(request: Request, { params }: Params) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId, kind } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !KINDS.includes(kind)) return invalidRequest(t("A valid upload is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/images/${kind}`, { method: "DELETE" }, t("The image could not be removed."));
}
