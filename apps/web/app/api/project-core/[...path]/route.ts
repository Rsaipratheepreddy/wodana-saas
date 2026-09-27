import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Projects: settings, starting a project from an accepted quotation, one project's stages, team, scope and work, and open work across projects. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "routes") return method === "POST";
  if (path.length === 2 && path[0] === "work-templates" && /^[a-z_]{1,12}$/.test(path[1])) return method === "PUT";
  if (path.length === 3 && path[0] === "routes" && UUID.test(path[1]) && path[2] === "archive") return method === "POST";
  if (path.length === 1 && path[0] === "ready") return method === "GET";
  if (path.length === 2 && path[0] === "start" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && (path[0] === "projects" || path[0] === "work")) return method === "GET";
  if (path.length === 2 && path[0] === "work" && path[1] === "insights") return method === "GET";
  if (path.length === 2 && path[0] === "projects" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 3 && path[0] === "projects" && UUID.test(path[1]) && ["scope", "materials", "close-out"].includes(path[2])) return method === "GET";
  if (path.length === 3 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "work") return ["GET", "POST"].includes(method);
  if (path.length === 4 && path[0] === "projects" && UUID.test(path[1]) && ["seals", "lines", "work"].includes(path[2]) && UUID.test(path[3])) return method === "GET";
  if (path.length === 5 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "work" && UUID.test(path[3]) && path[4] === "ripple") return method === "GET";
  if (path.length === 5 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "work" && path[3] === "sprints" && UUID.test(path[4])) return method === "GET";
  if (path.length === 6 && path[0] === "projects" && UUID.test(path[1]) && path[2] === "work" && path[3] === "packages" && UUID.test(path[4]) && path[5] === "plan") return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const search = new URL(request.url).searchParams;
  const workspaceId = search.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid project resource." }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 200_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  // Only the queries each read takes: whose open work, and the dates a preview tries.
  const forward = new URLSearchParams();
  if (path[0] === "work" && search.get("view") === "all") forward.set("view", "all");
  if (path[0] === "work" && path[1] === "insights" && search.get("days") === "90") forward.set("days", "90");
  if (path.at(-1) === "ripple" || path.at(-1) === "plan") for (const key of ["startDate", "dueDate"]) { const value = search.get(key); if (value !== null && /^(\d{4}-\d{2}-\d{2})?$/.test(value)) forward.set(key, value); }
  const query = forward.size ? `?${forward}` : "";
  return workspaceJsonResponse(`/workspaces/${workspaceId}/project-core/${path.join("/")}${query}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not update the project.");
}
export { handle as GET, handle as POST, handle as PUT };
