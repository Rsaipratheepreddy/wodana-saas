import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/owner-invitation/send">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid customer.");
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest("An invitation request key is required.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/owner-invitation/send`, {
    method: "POST", headers: { "idempotency-key": key },
  }, "The owner invitation could not be sent.");
}
