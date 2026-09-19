import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const statuses = new Set(["draft", "active", "archived"]);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  const status = query.get("status")?.trim() ?? "";
  const search = query.get("search")?.trim() ?? "";
  const legalEntityId = query.get("legalEntityId")?.trim() ?? "";
  const cursor = query.get("cursor")?.trim() ?? "";
  if (!UUID.test(workspaceId) || (status && !statuses.has(status)) || search.length > 240 || (legalEntityId && !UUID.test(legalEntityId)) || cursor.length > 1000) {
    return invalidRequest("Invalid supplier-offer request.");
  }
  const upstream = new URLSearchParams({ limit: "100" });
  if (status) upstream.set("status", status);
  if (search) upstream.set("search", search);
  if (legalEntityId) upstream.set("legalEntityId", legalEntityId);
  if (cursor) upstream.set("cursor", cursor);
  return workspaceJsonResponse(`/workspaces/${workspaceId}/supplier-offers?${upstream}`, { method: "GET" }, "Supplier offers could not be loaded.");
}
