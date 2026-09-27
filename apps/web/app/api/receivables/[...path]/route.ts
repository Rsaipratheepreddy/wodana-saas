import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Receivables: tax invoices to clients for projects' milestones, and credit notes. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "state") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "invoices" && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "milestones" && UUID.test(path[1]) && /^[\w-]{1,80}$/.test(path[2])) return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid receivables resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 100_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  const upstream = `/workspaces/${workspaceId}/receivables${path[0] === "state" ? "" : `/${path.map(encodeURIComponent).join("/")}`}`;
  return workspaceJsonResponse(upstream, { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST };
