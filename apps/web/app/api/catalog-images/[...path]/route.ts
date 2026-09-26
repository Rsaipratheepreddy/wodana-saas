import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Catalog item pictures: view (/{imageId}?preview=1), list and upload (/items/{itemId}[/{imageId}]), remove (DELETE /{imageId}). */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const view = path.length === 1 && UUID.test(path[0]) && request.method === "GET";
  const remove = path.length === 1 && UUID.test(path[0]) && request.method === "DELETE";
  const list = path.length === 2 && path[0] === "items" && UUID.test(path[1]) && request.method === "GET";
  const upload = path.length === 3 && path[0] === "items" && UUID.test(path[1]) && UUID.test(path[2]) && request.method === "POST";
  if (!UUID.test(workspaceId) || !(view || remove || list || upload)) return invalidRequest("Invalid catalog image.");
  const base = `/workspaces/${workspaceId}/catalog-images/${path.join("/")}`;
  if (view) {
    const result = await authenticatedBackendFetch(`${base}${url.searchParams.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) return NextResponse.json({ message: result.unauthenticated ? "Sign in again to see this image." : "The image could not be loaded." }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!isSameOrigin(request) && request.method !== "GET") return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  if (upload) {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest("Choose an image up to 20 MB.");
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !file.type.startsWith("image/")) return invalidRequest("Choose an image up to 20 MB.");
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(base, { method: "POST", body }, "The image could not be uploaded.");
  }
  return workspaceJsonResponse(base, { method: request.method }, "Could not update the catalog image.");
}
export { handle as GET, handle as POST, handle as DELETE };
