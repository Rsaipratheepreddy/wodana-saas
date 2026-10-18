import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const GRID_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** A list's workspace default (plan §0.7 R14): read by any member, saved by people who manage the module. */
async function handle(request: Request, { params }: { params: Promise<{ gridKey: string }> }) {
  const t = await getServerT();
  const { gridKey } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || gridKey.length > 80 || !GRID_KEY.test(gridKey)) return invalidRequest(t("Invalid list."));
  if (request.method === "GET") {
    return workspaceJsonResponse(`/workspaces/${workspaceId}/grid-settings/${gridKey}`, { method: "GET" }, t("The list default could not be loaded."));
  }
  if (!isSameOrigin(request)) return Response.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const body = await request.text();
  if (body.length > 20_000) return invalidRequest(t("The request is too large."));
  let payload: string;
  try { payload = JSON.stringify(JSON.parse(body || "{}")); } catch { return invalidRequest(t("Invalid JSON request.")); }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/grid-settings/${gridKey}`, { method: "PUT", headers: { "content-type": "application/json" }, body: payload }, t("The list default could not be saved."));
}

export { handle as GET, handle as PUT };
