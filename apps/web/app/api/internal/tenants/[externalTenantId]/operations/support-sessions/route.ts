import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: { params: Promise<{ externalTenantId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/support-sessions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: await request.text(),
  }, "Support access could not be requested.");
}
