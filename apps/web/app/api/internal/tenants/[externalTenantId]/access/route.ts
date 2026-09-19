import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/access">) {
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/access`, {
    method: "GET",
  }, "The tenant access explanation could not be loaded.");
}
