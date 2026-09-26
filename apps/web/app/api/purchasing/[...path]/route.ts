import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Purchasing: suppliers, what projects need to order, purchase orders, deliveries and their settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "suppliers") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "suppliers" && path[1] === "import") return method === "POST";
  if (path.length === 3 && path[0] === "suppliers" && UUID.test(path[1]) && ["approval", "archive"].includes(path[2])) return method === "POST";
  if (path.length === 1 && path[0] === "needs") return method === "GET";
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && (path[0] === "orders" || path[0] === "price-requests")) return ["GET", "POST"].includes(method);
  if (path.length === 2 && (path[0] === "orders" || path[0] === "price-requests") && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "deliveries") return method === "GET";
  if (path.length === 3 && path[0] === "orders" && UUID.test(path[1]) && path[2] === "receiving") return method === "GET";
  if (path.length === 1 && path[0] === "receipts") return method === "POST";
  if (path.length === 2 && path[0] === "receipts" && UUID.test(path[1])) return method === "GET";
  if (path.length === 3 && path[0] === "receipts" && UUID.test(path[1]) && ["inspection", "reversal"].includes(path[2])) return method === "POST";
  if (path.length === 1 && path[0] === "returns") return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "returns" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
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
export { handle as GET, handle as POST, handle as PUT };
