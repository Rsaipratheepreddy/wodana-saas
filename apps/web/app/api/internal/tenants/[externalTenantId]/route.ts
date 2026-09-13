import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]">) {
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/tenants/${encodeURIComponent(externalTenantId)}/management`, {
    method: "GET",
  }, "The client could not be loaded.");
}

export async function PATCH(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/tenants/${encodeURIComponent(externalTenantId)}/management`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, "The client could not be updated.");
}
