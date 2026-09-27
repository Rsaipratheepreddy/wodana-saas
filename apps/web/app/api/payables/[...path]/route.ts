import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Payables: suppliers' invoices (and their documents), payments to suppliers, what each is owed, and payment runs (and their bank files). */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "state") return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "runs") return method === "POST";
  if (path.length === 2 && ["bills", "suppliers", "orders", "runs"].includes(path[0]) && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "bills" && UUID.test(path[1]) && path[2] === "file") return ["GET", "POST"].includes(method);
  if (path.length === 3 && path[0] === "runs" && UUID.test(path[1]) && path[2] === "file") return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid payables resource.") }, { status: 400 });
  const upstream = `/workspaces/${workspaceId}/payables${path[0] === "state" ? "" : `/${path.join("/")}`}`;
  if (path[2] === "file" && request.method === "GET") {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) {
      // A run's bank file says why it can't be made (bank details changed, not approved yet).
      const reason = path[0] === "runs" && result.upstream ? await result.upstream.json().then((data) => (typeof data?.message === "string" ? data.message : null)).catch(() => null) : null;
      return NextResponse.json({ message: reason ?? t("The document could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    }
    const headers: Record<string, string> = { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": path[0] === "runs" ? "private, no-store" : "private, max-age=300", "x-content-type-options": "nosniff" };
    const disposition = result.upstream.headers.get("content-disposition");
    if (disposition) headers["content-disposition"] = disposition;
    const response = new NextResponse(result.upstream.body, { status: 200, headers });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (path[2] === "file") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: t("Choose a file up to 20 MB.") }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type.startsWith("image/") || file.type === "application/pdf"))
      return NextResponse.json({ message: t("Choose a PDF or a photo up to 20 MB.") }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, t("The file could not be uploaded."));
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 500_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST };
