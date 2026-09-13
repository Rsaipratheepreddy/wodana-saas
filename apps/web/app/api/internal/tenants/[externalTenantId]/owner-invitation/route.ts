import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/owner-invitation">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest("Choose a valid client.");
  return internalJsonResponse(`/internal/tenants/${encodeURIComponent(externalTenantId)}/owner-invitation/resend`, {
    method: "POST",
  }, "A new invitation link could not be created.");
}
