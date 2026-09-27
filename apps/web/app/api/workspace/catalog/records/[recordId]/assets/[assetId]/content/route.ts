import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

type Context = { params: Promise<{ recordId: string; assetId: string }> };

export async function GET(request: Request, context: Context) {
  const t = await getServerT();
  const { recordId, assetId } = await context.params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  const preview = query.get("preview") ?? "1";
  if (!UUID.test(workspaceId) || !UUID.test(recordId) || !UUID.test(assetId) || !["0", "1"].includes(preview))
    return invalidRequest(t("Invalid catalog image."));
  const result = await authenticatedBackendFetch(
    `/workspaces/${workspaceId}/catalog/records/${recordId}/assets/${assetId}/content?preview=${preview}`,
    { method: "GET" },
  );
  if (result.unauthenticated)
    return NextResponse.json({ message: t("Sign in again to view this catalog image.") }, { status: 401 });
  if (!result.upstream?.ok)
    return NextResponse.json({ message: t("This catalog image is unavailable.") }, { status: result.upstream?.status ?? 503 });
  const response = new NextResponse(await result.upstream.arrayBuffer(), { status: 200 });
  response.headers.set("content-type", result.upstream.headers.get("content-type") ?? "application/octet-stream");
  response.headers.set("cache-control", "private, max-age=300");
  response.headers.set("x-content-type-options", "nosniff");
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
