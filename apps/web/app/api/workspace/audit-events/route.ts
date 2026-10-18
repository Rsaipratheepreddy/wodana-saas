import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(request: Request) {
  const t = await getServerT();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const cursor = url.searchParams.get("cursor");
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (cursor && (cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    return invalidRequest(t("The audit cursor is invalid."));
  }
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/audit-events?${query}`,
    { method: "GET" },
    t("Audit events could not be loaded."),
  );
}
