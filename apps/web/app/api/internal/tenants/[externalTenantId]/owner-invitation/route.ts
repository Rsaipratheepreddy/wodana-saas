import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/owner-invitation">) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest(t("Choose a valid client."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/owner-invitation/resend`, {
    method: "POST",
  }, t("A new invitation link could not be created."));
}
