import { NextResponse } from "next/server";
import { UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { tKey } from "@/lib/i18n/keys";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ledger project profit (read only): `projects/{projectId}/pnl` is one project's P&L, `projects/profit` the Projects
 * profit grid for a company and period (`entity`, `from`, `to`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const search = new URL(request.url).searchParams;
  const workspaceId = search.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return NextResponse.json({ message: t(tKey("Invalid Ledger resource.")) }, { status: 400 });
  if (path.length === 2 && UUID.test(path[0]) && path[1] === "pnl")
    return workspaceJsonResponse(`/workspaces/${workspaceId}/books/projects/${path[0]}/pnl`, { method: "GET" }, t(tKey("Project profit didn't load.")));
  if (path.length === 1 && path[0] === "profit") {
    const forward = new URLSearchParams();
    const entity = search.get("entity");
    if (entity && UUID.test(entity)) forward.set("entity", entity);
    for (const key of ["from", "to"]) { const value = search.get(key); if (value && DAY.test(value)) forward.set(key, value); }
    return workspaceJsonResponse(`/workspaces/${workspaceId}/books/projects-profit${forward.size ? `?${forward}` : ""}`, { method: "GET" }, t(tKey("Project profit didn't load.")));
  }
  return NextResponse.json({ message: t(tKey("Invalid Ledger resource.")) }, { status: 400 });
}
