import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const PURPOSE = /^(kickoff|handover|warranty_claim)$/;
const allowed = (path: string[]) =>
  (path.length === 2 && path[0] === "documents" && path[1] === "client-invoice")
  || (path.length === 1 && path[0] === "commission-types")
  || (path.length === 1 && path[0] === "push-templates")
  || (path.length === 1 && path[0] === "questionnaires")
  || (path.length === 2 && path[0] === "questionnaires" && PURPOSE.test(path[1]))
  || (path.length === 3 && path[0] === "questionnaires" && PURPOSE.test(path[1]) && ["draft", "publish", "restore"].includes(path[2]));

/** §0.3 P3: the Setup module (questionnaires). */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path)) return invalidRequest(t("Invalid setup resource."));
  if (request.method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 60_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/setup/${path.join("/")}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("Setup could not be saved."));
}

export { handle as GET, handle as POST, handle as PUT };
