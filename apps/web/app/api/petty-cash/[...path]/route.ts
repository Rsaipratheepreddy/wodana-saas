import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Petty cash: a project's claims and receipts, and what the people who pay reimburse. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "state") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "projects" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 5 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "claims" && UUID.test(path[3]) && path[4] === "receipt") return method === "POST";
  if (path.length === 3 && path[0] === "claims" && UUID.test(path[1]) && path[2] === "receipt") return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid petty cash resource." }, { status: 400 });
  const upstream = `/workspaces/${workspaceId}/petty-cash${path[0] === "state" ? "" : `/${path.join("/")}`}`;
  if (path[0] === "claims") {
    const result = await authenticatedBackendFetch(upstream, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream || !result.upstream.ok) return NextResponse.json({ message: "The receipt could not be loaded." }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
    const response = new NextResponse(result.upstream.body, { status: 200, headers: { "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  if (path[4] === "receipt") {
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ message: "Choose a file up to 20 MB." }, { status: 400 });
    const input = await request.formData().catch(() => null);
    const file = input?.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !(file.type.startsWith("image/") || file.type === "application/pdf"))
      return NextResponse.json({ message: "Choose a PDF or a photo up to 20 MB." }, { status: 400 });
    const body = new FormData(); body.set("file", file);
    return workspaceJsonResponse(upstream, { method: "POST", body }, "The receipt could not be uploaded.");
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 50_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not save.");
}
export { handle as GET, handle as POST };
