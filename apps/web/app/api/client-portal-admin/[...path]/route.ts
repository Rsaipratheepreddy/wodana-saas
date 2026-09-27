import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** The firm's side of the client portal: settings, a project's portal and client contacts. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 2 && path[0] === "projects" && UUID.test(path[1])) return ["GET", "PUT"].includes(method);
  if (path.length === 3 && path[0] === "cases" && UUID.test(path[1]) && path[2] === "contacts") return ["GET", "PUT"].includes(method);
  if (path.length === 5 && path[0] === "cases" && UUID.test(path[1]) && path[2] === "contacts" && UUID.test(path[3]) && path[4] === "sign-out") return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid client portal resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 50_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/client-portal/${path.map(encodeURIComponent).join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}

export { handle as GET, handle as POST, handle as PUT };
