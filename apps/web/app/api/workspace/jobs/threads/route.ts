import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** §0.3: Team chat, every job thread the person sees, newest first, with what they haven't read. Read only. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("Invalid request."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/threads`, { method: "GET" }, t("Could not load."));
}
