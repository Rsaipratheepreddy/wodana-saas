import { NextResponse } from "next/server";
import { UUID, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Inventory: stock by place, its ledger, moves between places and the places. */
function allowed(path: string[], method: string) {
  if (path.length === 1 && ["stock", "transfers", "locations"].includes(path[0])) return ["GET", "POST"].includes(method);
  if (path.length === 1 && path[0] === "movements") return method === "GET";
  if (path.length === 1 && path[0] === "reorder-points") return method === "POST";
  if (path.length === 2 && path[0] === "transfers" && UUID.test(path[1])) return ["GET", "POST"].includes(method);
  if (path.length === 2 && path[0] === "adjustments" && UUID.test(path[1])) return method === "POST";
  return false;
}

const FILTERS = ["itemId", "locationId", "projectId"];

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return NextResponse.json({ message: t("Invalid inventory resource.") }, { status: 400 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const query = new URLSearchParams();
  for (const key of FILTERS) { const value = url.searchParams.get(key); if (value && UUID.test(value)) query.set(key, value); }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 2_000_000) return NextResponse.json({ message: t("The request is too large.") }, { status: 413 });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/inventory/${path.join("/")}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers: { "content-type": "application/json" }, body }, t("Could not save."));
}
export { handle as GET, handle as POST };
