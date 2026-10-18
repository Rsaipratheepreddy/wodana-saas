import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { getServerT } from "@/lib/i18n/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** PLM-146/148/156/157: the finishes settings and the sample library (its samples, archive, and each sample's photo). */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "samples") return ["GET", "POST"].includes(method);
  if (path.length === 3 && path[0] === "samples" && UUID.test(path[1]) && path[2] === "archive") return method === "POST";
  if (path.length === 3 && path[0] === "samples" && UUID.test(path[1]) && path[2] === "photo") return ["GET", "POST"].includes(method);
  return false;
}

/** The backend address: the settings are /finish-settings, the library /sample-library. */
const backend = (workspaceId: string, path: string[]) =>
  `/workspaces/${workspaceId}/${path[0] === "settings" ? "finish-settings" : ["sample-library", ...path.slice(1)].join("/")}`;

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return invalidRequest(t("Invalid sample library resource."));
  if (path[2] === "photo" && request.method === "GET") {
    const result = await authenticatedBackendFetch(`${backend(workspaceId, path)}${url.searchParams.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The photo could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "photo") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest(t("Choose a photo up to 20 MB."));
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !file.type.startsWith("image/")) return invalidRequest(t("Choose a photo up to 20 MB."));
    const form = new FormData(); form.set("file", file);
    return workspaceJsonResponse(backend(workspaceId, path), { method: "POST", body: form }, t("The photo could not be uploaded."));
  }
  // The library's search: the words, a price band, a category and whether archived samples show.
  const query = new URLSearchParams();
  if (path[0] === "samples" && request.method === "GET") {
    const q = url.searchParams.get("q");
    if (q) query.set("q", q.slice(0, 120));
    const band = url.searchParams.get("band");
    if (band && UUID.test(band)) query.set("band", band);
    const category = url.searchParams.get("category");
    if (category && /^[a-z][a-z0-9_]{0,39}$/.test(category)) query.set("category", category);
    if (url.searchParams.get("archived") === "1") query.set("archived", "1");
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`${backend(workspaceId, path)}${query.size ? `?${query}` : ""}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("The sample library could not be saved."));
}

export { handle as GET, handle as POST, handle as PUT };
