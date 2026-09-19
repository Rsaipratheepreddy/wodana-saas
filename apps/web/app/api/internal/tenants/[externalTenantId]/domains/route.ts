import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/domains">) {
  const { externalTenantId } = await context.params;
  if (!VALID_TENANT.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/domains`, {
    method: "GET",
  }, "Domains could not be loaded.");
}

export async function POST(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/domains">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!VALID_TENANT.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest("A domain request key is required.");
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/domains`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: await request.text(),
  }, "The domain could not be requested.");
}
