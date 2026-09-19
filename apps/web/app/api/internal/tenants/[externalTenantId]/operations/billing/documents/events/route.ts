import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;
const VALID_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

export async function POST(request: Request, context: { params: Promise<{ externalTenantId: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  const key = request.headers.get("idempotency-key") ?? "";
  if (!VALID_TENANT.test(externalTenantId) || !VALID_KEY.test(key)) {
    return invalidRequest("Choose a valid client and idempotency key.");
  }
  return internalJsonResponse(
    `/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/billing/documents/events`,
    { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: await request.text() },
    "The billing document event could not be recorded.",
  );
}
