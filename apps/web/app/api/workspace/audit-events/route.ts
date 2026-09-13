import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const cursor = url.searchParams.get("cursor");
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (cursor && (cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    return invalidRequest("The audit cursor is invalid.");
  }
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/audit-events?${query}`,
    { method: "GET" },
    "Audit events could not be loaded.",
  );
}
