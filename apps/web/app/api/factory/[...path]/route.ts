import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** The factory: what to make, work orders and their output, and its settings. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && ["state", "schedule"].includes(path[0])) return method === "GET";
  if (path.length === 1 && path[0] === "batches") return method === "POST";
  if (path.length === 1 && path[0] === "orders") return method === "POST";
  if (path.length === 2 && path[0] === "orders" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "settings") return ["GET", "PUT"].includes(method);
  if (path.length === 1 && path[0] === "workcenters") return method === "POST";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid factory resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 1_000_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  // The schedule's window: a date and a number of days.
  const query = new URLSearchParams();
  const from = url.searchParams.get("from");
  const days = url.searchParams.get("days");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query.set("from", from);
  if (days && /^\d{1,3}$/.test(days)) query.set("days", days);
  return workspaceJsonResponse(`/workspaces/${workspaceId}/factory/${path.join("/")}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST, handle as PUT };
