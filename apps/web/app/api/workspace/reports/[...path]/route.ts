import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Management dashboards (PLM-134): the filter options, a dashboard, the records behind a figure, and the KPI targets. */
const DASHBOARDS = new Set(["owner-overview", "sales-pipeline", "lead-response", "design-projects"]);

function allowed(path: string[], method: string) {
  if (path.length === 1 && path[0] === "options") return method === "GET";
  if (path.length === 1 && path[0] === "targets") return method === "GET" || method === "PUT";
  if (path.length === 1 && DASHBOARDS.has(path[0])) return method === "GET";
  if (path.length === 2 && DASHBOARDS.has(path[0]) && path[1] === "records") return method === "GET";
  return false;
}

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path, request.method)) return invalidRequest(t("Invalid report request."));
  if (request.method !== "GET" && !isSameOrigin(request)) return Response.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const query = new URLSearchParams(url.searchParams);
  query.delete("workspaceId");
  if (query.toString().length > 2000) return invalidRequest(t("The request filters are too long."));
  let body: string | undefined;
  if (request.method === "PUT") {
    body = await request.text();
    if (body.length > 100_000) return invalidRequest(t("The request is too large."));
    try { const parsed: unknown = JSON.parse(body || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidRequest(t("A JSON object is required.")); body = JSON.stringify(parsed); }
    catch { return invalidRequest(t("Invalid JSON request.")); }
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/reports/management/${path.join("/")}${query.size ? `?${query}` : ""}`, {
    method: request.method, headers: { "content-type": "application/json" }, body,
  }, t("The report could not be loaded."));
}

export { handle as GET, handle as PUT };
