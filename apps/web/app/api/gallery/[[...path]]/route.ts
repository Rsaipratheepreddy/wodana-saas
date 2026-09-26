import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** The owner's gallery editor: settings, items, catalog import and pictures. */
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const method = request.method;
  const allowed = (path.length === 0 && ["GET", "PUT"].includes(method))
    || (path.length === 1 && path[0] === "catalog" && method === "GET")
    || (path.length === 1 && path[0] === "items" && method === "POST")
    || (path.length === 2 && path[0] === "items" && ["order", "from-catalog"].includes(path[1]) && method === "POST")
    || (path.length === 2 && path[0] === "items" && UUID.test(path[1]) && method === "DELETE")
    || (path.length === 2 && path[0] === "images" && UUID.test(path[1]) && ["GET", "POST", "DELETE"].includes(method));
  if (!UUID.test(workspaceId) || !allowed) return invalidRequest("Invalid gallery resource.");
  const base = `/workspaces/${workspaceId}/gallery${path.length ? `/${path.join("/")}` : ""}`;
  if (path[0] === "images" && method === "GET") {
    const result = await authenticatedBackendFetch(`${base}${url.searchParams.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) return NextResponse.json({ message: "The image could not be loaded." }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  if (path[0] === "images" && method === "POST") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest("Choose an image up to 20 MB.");
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !file.type.startsWith("image/")) return invalidRequest("Choose an image up to 20 MB.");
    const body = new FormData(); body.set("file", file);
    const itemId = url.searchParams.get("itemId");
    return workspaceJsonResponse(`${base}${itemId && UUID.test(itemId) ? `?itemId=${itemId}` : ""}`, { method: "POST", body }, "The image could not be uploaded.");
  }
  if (path[0] === "catalog") return workspaceJsonResponse(`${base}?${new URLSearchParams({ q: (url.searchParams.get("q") ?? "").slice(0, 80) })}`, { method: "GET" }, "Could not load the catalog.");
  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();
  if (body && body.length > 200_000) return invalidRequest("The request is too large.");
  return workspaceJsonResponse(base, { method, headers: { "content-type": "application/json" }, body }, "Could not update the gallery.");
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
