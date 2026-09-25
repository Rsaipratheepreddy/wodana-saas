import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID } from "@/lib/workspace/workspace-api";

/** A colleague's profile photo; only members of the workspace can load it. */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const { workspaceId, userId } = await context.params;
  if (!UUID.test(workspaceId) || !UUID.test(userId)) return new NextResponse(null, { status: 404 });
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/members/${userId}/photo`, { method: "GET" });
  if (result.unauthenticated || !result.upstream?.ok || !result.upstream.body) {
    const response = new NextResponse(null, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  const response = new NextResponse(result.upstream.body, {
    headers: { "cache-control": "private, max-age=86400", "content-type": result.upstream.headers.get("content-type") ?? "image/webp", etag: result.upstream.headers.get("etag") ?? "" },
  });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
