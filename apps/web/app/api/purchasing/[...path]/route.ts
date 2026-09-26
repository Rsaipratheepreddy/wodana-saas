import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Purchasing: the supplier register (and, as they land, what to order and purchase orders). */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "suppliers") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "suppliers" && path[1] === "import") return method === "POST";
  if (path.length === 3 && path[0] === "suppliers" && UUID.test(path[1]) && ["approval", "archive"].includes(path[2])) return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: "Invalid purchasing resource." }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: "Use your workspace to make this change." }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 2_000_000) return NextResponse.json({ message: "The request is too large." }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/purchasing/${path.join("/")}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, "Could not save.");
}
export { handle as GET, handle as POST };
