import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Accounting: where each company posts, and the postings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return method === "GET";
  if (path.length === 1 && path[0] === "links") return method === "PUT";
  if (path.length === 1 && path[0] === "postings") return method === "GET";
  if (path.length === 3 && path[0] === "postings" && UUID.test(path[1]) && path[2] === "retry") return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid accounting resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  const upstream = `/workspaces/${workspaceId}/accounting${path[0] === "settings" ? "" : `/${path.join("/")}`}`;
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST, handle as PUT };
