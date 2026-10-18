import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

/** Settings → AI apps: whether AI apps may connect, and the connections this person may see. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/ai/mcp`, { method: "GET" }, t("AI apps didn't load."));
}

/** Switch AI apps on or off for the workspace (owners and administrators), against the version read. */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const body = await request.json().catch(() => null) as { workspaceId?: unknown; enabled?: unknown; version?: unknown } | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (typeof body?.enabled !== "boolean" || typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 0) {
    return invalidRequest(t("AI apps could not be saved."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/ai/mcp`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: body.enabled, version: body.version }),
  }, t("AI apps could not be saved."));
}
