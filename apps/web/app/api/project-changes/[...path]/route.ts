import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const STEPS = ["price", "submit", "decide", "send", "send-link", "apply", "withdraw"];

/** Changes on a project: the list, what they're made of, one change and its steps, the timeline preview, and its files. */
function allowed(path: string[], method: string) {
  if (!UUID.test(path[0] ?? "")) return false;
  if (path.length === 1) return ["GET", "POST"].includes(method);
  if (path.length === 2 && ["sources", "variations"].includes(path[1])) return method === "GET";
  if (path.length === 2 && path[1] === "preview") return method === "POST";
  if (path.length === 2 && UUID.test(path[1])) return ["GET", "PUT"].includes(method);
  if (path.length === 3 && path[1] === "files" && UUID.test(path[2])) return method === "GET";
  if (path.length === 3 && UUID.test(path[1]) && STEPS.includes(path[2])) return method === "POST";
  if (path.length === 4 && UUID.test(path[1]) && path[2] === "files" && UUID.test(path[3])) return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const search = new URL(request.url).searchParams;
  const workspaceId = search.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid change request.") }, { status: 400 });
  const base = `/workspaces/${workspaceId}/project-changes/${path.join("/")}`;
  // A change's photos and files stream back as files.
  if (path[1] === "files" && request.method === "GET") {
    const result = await authenticatedBackendFetch(`${base}${search.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const disposition = result.upstream.headers.get("content-disposition");
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", ...(disposition ? { "content-disposition": disposition } : {}) } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "files") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type === "application/pdf" || file.type.startsWith("image/")))
      return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(base, { method: "POST", body }, t("The file could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  const query = path[1] === "sources" && search.get("search") ? `?${new URLSearchParams({ search: (search.get("search") ?? "").slice(0, 120) })}` : "";
  return workspaceJsonResponse(`${base}${query}`, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not update the change."));
}
export { handle as GET, handle as POST, handle as PUT };
