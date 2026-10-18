import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const KIND = /^[a-z_]{1,40}$/;

/** §0.3 P0: add the photo or PDF behind a decision (POST, with what it is for), or open one (GET /:fileId). */
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const t = await getServerT();
  const path = (await params).path ?? [];
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || path.length > 1 || !path.every((id) => UUID.test(id))) return invalidRequest(t("Invalid request."));
  const [fileId] = path;
  if (request.method === "GET") {
    if (!fileId) return invalidRequest(t("Invalid request."));
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/evidence/${fileId}${query.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 502 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const response = new NextResponse(result.upstream.body, { status: 200, headers: {
      "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": result.upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
    } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (fileId) return invalidRequest(t("Invalid request."));
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest(t("Choose a file up to 20 MB."));
  try {
    const input = await request.formData();
    const file = input.get("file"), kind = String(input.get("kind") ?? "");
    if (!KIND.test(kind)) return invalidRequest(t("Invalid request."));
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) return invalidRequest(t("Choose an image or PDF up to 20 MB."));
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/evidence`, { method: "POST", body }, t("The file could not be uploaded."));
  } catch { return invalidRequest(t("Choose a valid file.")); }
}

export { handle as GET, handle as POST };
