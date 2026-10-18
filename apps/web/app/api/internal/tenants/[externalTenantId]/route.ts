import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]">) {
  const t = await getServerT();
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest(t("Choose a valid client."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/management`, {
    method: "GET",
  }, t("The client could not be loaded."));
}

export async function PATCH(request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]">) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest(t("Choose a valid client."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/management`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, t("The client could not be updated."));
}
