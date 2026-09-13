import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { intelligenceApiUrl } from "@/lib/auth/server";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";

type Context = { params: Promise<{ connectionId: string; mediaId: string }> };

export async function GET(request: Request, context: Context) {
  const { connectionId, mediaId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(connectionId) || !/^\d{1,80}$/.test(mediaId)) return invalidRequest("Invalid media.");
  const result = await authenticatedBackendFetch(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/media/${mediaId}`, { method: "GET" }, intelligenceApiUrl);
  if (result.unauthenticated) return NextResponse.json({ message: "Sign in again to view this media." }, { status: 401 });
  if (!result.upstream?.ok) return NextResponse.json({ message: "This media is no longer available." }, { status: result.upstream?.status ?? 503 });
  const response = new NextResponse(await result.upstream.arrayBuffer(), { status: 200 });
  response.headers.set("content-type", result.upstream.headers.get("content-type") ?? "application/octet-stream");
  response.headers.set("cache-control", "private, max-age=300");
  response.headers.set("x-content-type-options", "nosniff");
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
