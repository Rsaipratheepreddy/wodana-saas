import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Payables: suppliers' invoices (and their documents), payments to suppliers, and what each is owed. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "state") return ["GET", "POST"].includes(method);
  if (path.length === 2 && ["bills", "suppliers", "orders"].includes(path[0]) && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "bills" && UUID.test(path[1]) && path[2] === "file") return ["GET", "POST"].includes(method);
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid payables resource." }, { status: 400 });
  const upstream = `/workspaces/${workspaceId}/payables${path[0] === "state" ? "" : `/${path.join("/")}`}`;
  if (path[2] === "file" && request.method === "GET") {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: "The document could not be loaded." }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  if (path[2] === "file") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: "Choose a file up to 20 MB." }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type.startsWith("image/") || file.type === "application/pdf"))
      return NextResponse.json({ message: "Choose a PDF or a photo up to 20 MB." }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, "The file could not be uploaded.");
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 500_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not save.");
}
export { handle as GET, handle as POST };
