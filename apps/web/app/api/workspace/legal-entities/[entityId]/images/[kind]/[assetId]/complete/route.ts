import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Checks an uploaded logo or letterhead header and sets it on the business. */
export async function POST(request: Request, { params }: { params: Promise<{ entityId: string; kind: string; assetId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId, kind, assetId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !UUID.test(assetId) || !["logo", "letterhead"].includes(kind)) return invalidRequest(t("A valid upload is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/images/${kind}/uploads/${assetId}/complete`, { method: "POST" }, t("The image could not be verified."));
}
