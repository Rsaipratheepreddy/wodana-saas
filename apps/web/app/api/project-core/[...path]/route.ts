import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Projects: settings, starting a project from an accepted quotation, and one project's stages, team and status. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "routes") return method === "POST";
  if (path.length === 3 && path[0] === "routes" && UUID.test(path[1]) && path[2] === "archive") return method === "POST";
  if (path.length === 1 && path[0] === "ready") return method === "GET";
  if (path.length === 2 && path[0] === "start" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "projects") return method === "GET";
  if (path.length === 2 && path[0] === "projects" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 3 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "scope") return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid project resource." }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/project-core/${path.join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not update the project.");
}
export { handle as GET, handle as POST, handle as PUT };
