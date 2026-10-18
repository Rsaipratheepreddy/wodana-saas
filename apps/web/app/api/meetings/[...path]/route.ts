import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** PLM-153: a client meeting's minutes: read and saved, the team's replies, and their photos and PDFs (added and opened). */
function allowed(path: string[], method: string) {
  if (!UUID.test(path[0] ?? "") || path[1] !== "minutes") return false;
  if (path.length === 2) return ["GET", "PUT"].includes(method);
  if (path.length === 3 && path[2] === "replies") return method === "POST";
  if (path.length === 4 && path[2] === "files" && UUID.test(path[3])) return ["GET", "POST"].includes(method);
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const search = new URL(request.url).searchParams;
  const workspaceId = search.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid meeting resource.") }, { status: 400 });
  const upstream = `/workspaces/${workspaceId}/meetings/${path.join("/")}`;
  // A file of the minutes streams back as a file.
  if (path[2] === "files" && request.method === "GET") {
    const result = await authenticatedBackendFetch(`${upstream}${search.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const disposition = result.upstream.headers.get("content-disposition");
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", ...(disposition ? { "content-disposition": disposition } : {}) } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "files") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a PDF or image up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type === "application/pdf" || file.type.startsWith("image/")))
      return NextResponse.json({ message: t("Choose a PDF or image up to 20 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, t("The file could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save the minutes."));
}
export { handle as GET, handle as POST, handle as PUT };
