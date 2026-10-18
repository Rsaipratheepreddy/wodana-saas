import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** §0.3: the job's team thread: read it, post to it, mark it read. */
async function handle(request: Request, { params }: { params: Promise<{ jobId: string; action?: string[] }> }) {
  const t = await getServerT();
  const { jobId, action = [] } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const step = action.join("/");
  const allowed = request.method === "GET" ? step === "" : request.method === "POST" && (step === "" || step === "read");
  if (!UUID.test(workspaceId) || !UUID.test(jobId) || !allowed) return invalidRequest(t("Invalid request."));
  if (request.method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 20_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/${jobId}/thread${step ? `/${step}` : ""}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("Could not save."));
}

export { handle as GET, handle as POST };
