import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** The factory: what to make, work orders and their output, and its settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "state") return method === "GET";
  if (path.length === 1 && path[0] === "orders") return method === "POST";
  if (path.length === 2 && path[0] === "orders" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "workcenters") return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid factory resource." }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1_000_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/factory/${path.join("/")}`, { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not save.");
}
export { handle as GET, handle as POST, handle as PUT };
