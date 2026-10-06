import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

/** The image's bytes, through Wodana, when there is no object storage (as the company logo). */
export async function PUT(request: Request, context: { params: Promise<{ entityId: string; kind: string; assetId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId, kind, assetId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !UUID.test(assetId) || !["logo", "letterhead"].includes(kind)) return invalidRequest(t("A valid upload is required."));
  const body = await request.arrayBuffer();
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/legal-entities/${entityId}/images/${kind}/uploads/${assetId}/content`, {
    method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream", "content-length": String(body.byteLength) }, body,
  });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: t("Your session has expired. Sign in again.") }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) return NextResponse.json({ message: t("Image uploads are unavailable.") }, { status: 503 });
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(result.upstream.ok ? payload : { message: safeBackendMessage(payload, t("The image could not be uploaded.")) }, { status: result.upstream.status });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
