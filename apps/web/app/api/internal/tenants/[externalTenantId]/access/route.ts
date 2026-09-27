import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(_request: Request, context: RouteContext<"/api/internal/tenants/[externalTenantId]/access">) {
  const t = await getServerT();
  const { externalTenantId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(externalTenantId)) return invalidRequest(t("Choose a valid client."));
  return internalJsonResponse(`/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/access`, {
    method: "GET",
  }, t("The tenant access explanation could not be loaded."));
}
