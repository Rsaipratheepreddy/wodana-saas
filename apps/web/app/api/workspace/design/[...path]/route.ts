import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const allowed = (path: string[]) =>
  (path.length === 1 && path[0] === "settings")
  || (path.length === 1 && path[0] === "packages")
  || (path.length === 3 && path[0] === "packages" && UUID.test(path[1]) && ["status", "quote"].includes(path[2]));

/** Design settings and the design package price list (PLM-041). */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !allowed(path)) return invalidRequest(t("Invalid design resource."));
  if (request.method !== "GET" && !isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 20_000) return invalidRequest(t("The request is too large."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/design/${path.join("/")}`, {
    method: request.method, ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  }, t("Design settings could not be saved."));
}

export { handle as GET, handle as POST, handle as PUT };
