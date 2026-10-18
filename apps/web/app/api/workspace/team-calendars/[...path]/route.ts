import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { allowedTeamCalendarPath } from "@/lib/crm/team-calendar-path";

const TEAM = /^(design|logistics)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowedTeamCalendarPath(path, request.method)) return invalidRequest(t("Invalid calendar resource."));
  if (request.method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const query = new URLSearchParams();
  if (request.method === "GET" && path.length === 1 && TEAM.test(path[0])) {
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    if (!DAY.test(from) || !DAY.test(to)) return invalidRequest(t("Choose a valid range"));
    query.set("from", from); query.set("to", to);
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 250_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/team-calendars/${path.join("/")}${query.size ? `?${query}` : ""}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("The calendar could not be updated."));
}

export { handle as GET, handle as POST, handle as PUT };
