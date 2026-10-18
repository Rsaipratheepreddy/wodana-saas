import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** §0.3 P11: the step now's suggestions (GET), and using or dismissing one (POST …/suggestions/:id). */
async function handle(request: Request, { params }: { params: Promise<{ jobId: string; id?: string[] }> }) {
  const t = await getServerT();
  const { jobId, id = [] } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const suggestionId = id[0] ?? "";
  const allowed = request.method === "GET" ? id.length === 0 : request.method === "POST" && id.length === 1 && UUID.test(suggestionId);
  if (!UUID.test(workspaceId) || !UUID.test(jobId) || !allowed) return invalidRequest(t("Invalid request."));
  if (request.method === "POST" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > 2_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/${jobId}/suggestions${suggestionId ? `/${suggestionId}` : ""}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("Could not save."));
}

export { handle as GET, handle as POST };
