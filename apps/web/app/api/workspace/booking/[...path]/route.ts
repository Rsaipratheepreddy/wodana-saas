import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const collections = new Set(["types", "bookings", "overrides"]);
const actions = new Set(["confirm", "decline", "complete", "no-show"]);

/** Booking types, bookings and availability overrides for the signed-in workspace (Sales settings). */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const valid = UUID.test(workspaceId) && collections.has(path[0]) && path.length <= 3
    && (path.length < 2 || UUID.test(path[1])) && (path.length < 3 || (path[0] === "bookings" && actions.has(path[2])));
  if (!valid) return invalidRequest(t("Invalid booking resource."));
  if (request.method !== "GET" && !isSameOrigin(request)) return Response.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const query = new URLSearchParams(url.searchParams);
  query.delete("workspaceId");
  let body: string | undefined;
  if (!["GET", "DELETE"].includes(request.method)) {
    body = await request.text();
    if (body.length > 100_000) return invalidRequest(t("The request is too large."));
    try { body = JSON.stringify(JSON.parse(body || "{}")); } catch { return invalidRequest(t("Invalid JSON request.")); }
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/booking/${path.join("/")}${query.size ? `?${query}` : ""}`, { method: request.method, headers: { "content-type": "application/json" }, body }, t("The booking request could not be completed."));
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
