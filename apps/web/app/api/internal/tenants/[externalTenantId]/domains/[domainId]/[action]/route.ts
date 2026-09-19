import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;
const ACTIONS = new Set(["verify", "recheck", "rotate-challenge", "remove"]);

export async function POST(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/domains/[domainId]/[action]">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId, domainId, action } = await context.params;
  if (!VALID_TENANT.test(externalTenantId) || !UUID.test(domainId) || !ACTIONS.has(action)) {
    return invalidRequest("Choose a valid domain action.");
  }
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/domains/${domainId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, "The domain could not be updated.");
}
