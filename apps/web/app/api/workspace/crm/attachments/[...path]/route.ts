import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * A chat file: GET reads it from the workspace's private storage (never from the provider, so it works while
 * someone views as a colleague), POST uploads one for a reply. /api/workspace/crm/attachments/<chat>/<file>
 */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || path.length !== 2 || !path.every((id) => UUID.test(id))) return invalidRequest(t("Invalid file."));
  const backendPath = `/workspaces/${workspaceId}/crm/conversations/${path[0]}/attachments/${path[1]}`;
  if (request.method === "GET") {
    const range = request.headers.get("range");
    const result = await authenticatedBackendFetch(backendPath, { cache: "no-store", ...(range ? { headers: { range } } : {}) });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("This file isn't available.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const headers: Record<string, string> = {
      "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": result.upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
    };
    for (const name of ["accept-ranges", "content-range", "content-length"]) { const value = result.upstream.headers.get(name); if (value) headers[name] = value; }
    const response = new NextResponse(result.upstream.body, { status: result.upstream.status, headers });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  if (Number(request.headers.get("content-length")) > MAX_BYTES + 1024 * 1024) return invalidRequest(t("Files can be up to 20 MB."));
  try {
    const input = await request.formData(), file = input.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return invalidRequest(t("Files can be up to 20 MB."));
    const body = new FormData();
    body.set("file", file);
    return workspaceJsonResponse(backendPath, { method: "POST", body }, t("The file could not be attached."));
  } catch { return invalidRequest(t("Choose a valid file.")); }
}

export { handle as GET, handle as POST };
