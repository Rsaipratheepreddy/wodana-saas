import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const FILE_KINDS = ["quote", "tax_invoice", "proof", "other"];
const LISTS = ["context", "options", "quote-lines"];

/** Finance requests: the board, one request, its commands and files, what the form offers, and Finance's settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && (path[0] === "board" || path[0] === "settings")) return ["GET", "POST"].includes(method);
  if (path.length === 1 && LISTS.includes(path[0])) return method === "GET";
  if (path.length === 2 && path[0] === "requests" && UUID.test(path[1])) return method === "GET";
  if (path.length === 4 && path[0] === "requests" && UUID.test(path[1]) && path[2] === "files") {
    if (method === "POST") return FILE_KINDS.includes(path[3]);
    return method === "GET" && UUID.test(path[3]);
  }
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid finance request resource.") }, { status: 400 });
  const query = new URLSearchParams(url.searchParams);
  query.delete("workspaceId");
  const rest = path[0] === "board" ? "" : path[0] === "requests" ? `/${path.slice(1).join("/")}` : `/${path[0]}`;
  const upstream = `/workspaces/${workspaceId}/finance-requests${rest}${LISTS.includes(path[0]) && query.size ? `?${query}` : ""}`;
  if (path[2] === "files" && request.method === "GET") {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "files") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a file up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type.startsWith("image/") || file.type === "application/pdf"))
      return NextResponse.json({ message: t("Choose a PDF or a photo up to 20 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, t("The file could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST };
