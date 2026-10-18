import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Fulfilment: a won order on its deal (read and its commands) and the rules per enquiry type and path. */
function allowed(path: string[], method: string) {
  if (path.length === 2 && path[0] === "deals" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "rules") return method === "GET";
  if (path.length === 2 && path[0] === "rules" && UUID.test(path[1])) return method === "PUT";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid fulfilment resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/fulfilment/${path.join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST, handle as PUT };
