import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: { params: Promise<{ externalTenantId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest("An operation request key is required.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/plans`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: await request.text(),
  }, "The tenant operation could not be planned.");
}
