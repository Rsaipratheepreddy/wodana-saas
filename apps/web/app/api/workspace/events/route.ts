import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, invalidRequest } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * The workspace's live event stream (server-sent events), passed through from Business Core as it arrives.
 * `no-transform` keeps compression from buffering it; `X-Accel-Buffering: no` keeps the proxy from doing so.
 */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/events`, { headers: { accept: "text/event-stream" }, cache: "no-store", signal: request.signal });
  if (!result.upstream?.ok || !result.upstream.body) {
    const response = NextResponse.json({ message: t("Live updates are unavailable.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  const response = new NextResponse(result.upstream.body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
