import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/status">) {
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/status`, {
    method: "GET",
  }, "The client status could not be loaded.");
}
