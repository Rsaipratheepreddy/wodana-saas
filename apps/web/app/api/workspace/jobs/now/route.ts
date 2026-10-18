import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** §0.3 P10: where each listed record's job is now (records=type:id,…), read from the journey. Read only. */
export async function GET(request: Request) {
  const t = await getServerT();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const records = url.searchParams.get("records") ?? "";
  if (!UUID.test(workspaceId) || records.length > 9000 || !/^[a-z]+:[0-9a-f-]{36}(,[a-z]+:[0-9a-f-]{36})*$/i.test(records)) return invalidRequest(t("Invalid request."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/now?records=${encodeURIComponent(records)}`, { method: "GET" }, t("Could not load."));
}
