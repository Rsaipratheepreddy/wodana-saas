import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** Every job with where it is now, for the quick panel's search. Read only. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("Invalid request."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/overview?limit=100`, { method: "GET" }, t("Could not load."));
}
