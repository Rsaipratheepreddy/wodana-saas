import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Bill capture (Ledger): a bill's photo or PDF read into a draft supplier invoice, its file, and the tax codes and accounts a bill line can name. */
const MAX_BYTES = 6 * 1024 * 1024;

function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "captures") return method === "POST";
  if (path.length === 2 && path[0] === "captures" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 3 && path[0] === "captures" && UUID.test(path[1]) && path[2] === "file") return method === "GET";
  if (path.length === 2 && path[0] === "bill-coding" && UUID.test(path[1])) return method === "GET";
  return false;
}

export const maxDuration = 60;

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid capture resource.") }, { status: 400 });
  const date = url.searchParams.get("date");
  const query = path[0] === "bill-coding" && date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?${new URLSearchParams({ date })}` : "";
  const upstream = `/workspaces/${workspaceId}/books/${path.join("/")}${query}`;
  if (path[2] === "file") {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok)
      return NextResponse.json({ message: t("The document could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: {
      "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path.length === 1) {
    if (Number(request.headers.get("content-length")) > MAX_BYTES + 64 * 1024) return NextResponse.json({ message: t("Choose a photo or PDF up to 6 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return NextResponse.json({ message: t("Choose a photo or PDF up to 6 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, t("The bill could not be read."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 20_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body, cache: "no-store" }, t("Could not save."));
}
export { handle as GET, handle as POST };
