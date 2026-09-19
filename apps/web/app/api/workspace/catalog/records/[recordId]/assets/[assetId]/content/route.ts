import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";

type Context = { params: Promise<{ recordId: string; assetId: string }> };

export async function GET(request: Request, context: Context) {
  const { recordId, assetId } = await context.params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  const preview = query.get("preview") ?? "1";
  if (!UUID.test(workspaceId) || !UUID.test(recordId) || !UUID.test(assetId) || !["0", "1"].includes(preview))
    return invalidRequest("Invalid catalog image.");
  const result = await authenticatedBackendFetch(
    `/workspaces/${workspaceId}/catalog/records/${recordId}/assets/${assetId}/content?preview=${preview}`,
    { method: "GET" },
  );
  if (result.unauthenticated)
    return NextResponse.json({ message: "Sign in again to view this catalog image." }, { status: 401 });
  if (!result.upstream?.ok)
    return NextResponse.json({ message: "This catalog image is unavailable." }, { status: result.upstream?.status ?? 503 });
  const response = new NextResponse(await result.upstream.arrayBuffer(), { status: 200 });
  response.headers.set("content-type", result.upstream.headers.get("content-type") ?? "application/octet-stream");
  response.headers.set("cache-control", "private, max-age=300");
  response.headers.set("x-content-type-options", "nosniff");
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
